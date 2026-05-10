import { createHmac } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_STATUS_PATH = path.join(ROOT, 'public', 'paper_status.json');
const EXEC_LOG_PATH = process.env.EXECUTOR_LOG_PATH || path.join(ROOT, 'data', 'execution_audit.jsonl');

const ENVIRONMENTS = {
  testnet: 'https://testnet.binancefuture.com',
  live: 'https://fapi.binance.com'
};

const LIVE_CONFIRM = 'ENABLE_REAL_BINANCE_FUTURES_ORDERS';
const KILL_CONFIRM = 'CLOSE_ALL_POSITIONS';

const args = parseArgs(process.argv.slice(2));
const command = args._[0] || 'preflight';

main().catch(error => {
  console.error(JSON.stringify({ ok: false, command, error: error.message || String(error) }, null, 2));
  process.exit(1);
});

async function main(){
  const client = makeClient();
  if(command === 'preflight') return print(await preflight(client));
  if(command === 'validate-sample') return print(await validateSampleOrder(client));
  if(command === 'reconcile') return print(await reconcile(client));
  if(command === 'execute-bracket') return print(await executeBracket(client));
  if(command === 'kill-switch') return print(await killSwitch(client));
  throw new Error(`Unknown command: ${command}`);
}

function makeClient(){
  const env = String(process.env.BINANCE_EXECUTION_ENV || args.env || 'testnet').toLowerCase();
  if(!ENVIRONMENTS[env]) throw new Error(`BINANCE_EXECUTION_ENV must be testnet or live, got ${env}`);
  return {
    env,
    baseUrl: process.env.BINANCE_FUTURES_BASE_URL || ENVIRONMENTS[env],
    apiKey: process.env.BINANCE_API_KEY || '',
    apiSecret: process.env.BINANCE_API_SECRET || '',
    recvWindow: Math.floor(number(process.env.BINANCE_RECV_WINDOW, 5000)),
    maxLiveOrderUsdt: number(process.env.MAX_LIVE_ORDER_USDT, 25),
    statusPath: process.env.PAPER_STATUS_PATH || args.status || DEFAULT_STATUS_PATH
  };
}

async function preflight(client){
  const status = await loadPaperStatus(client.statusPath);
  const checks = [];
  checks.push(check('apiKeyPresent', 'API key present', !!client.apiKey));
  checks.push(check('apiSecretPresent', 'API secret present', !!client.apiSecret));
  checks.push(check('envIsTestnetOrLive', 'execution environment is explicit', client.env === 'testnet' || client.env === 'live', client.env));
  checks.push(check('paperStatusReadable', 'paper status file is readable', !!status.paper, client.statusPath));
  checks.push(check('readinessReady', 'paper readiness is TESTNET_READY', status.paper?.readiness?.status === 'TESTNET_READY', status.paper?.readiness?.status || 'missing'));
  checks.push(check('noPaperErrors', 'paper engine has no errors', (status.paper?.errors || []).length === 0, `${(status.paper?.errors || []).length} errors`));
  checks.push(check('marketQualityPass', 'market quality has passing symbols', (status.paper?.marketQuality?.passed || 0) > 0, `${status.paper?.marketQuality?.passed || 0}/${status.paper?.marketQuality?.total || 0}`));

  let account = null;
  let positionMode = null;
  if(client.apiKey && client.apiSecret){
    const time = await signed(client, 'GET', '/fapi/v1/time', {}, { public: true }).catch(() => null);
    checks.push(check('serverReachable', 'Binance futures API reachable', !!time, time?.serverTime || 'failed'));

    account = await signed(client, 'GET', '/fapi/v3/account').catch(error => ({ error: error.message || String(error) }));
    checks.push(check('accountReadable', 'account endpoint readable', !account?.error, account?.error || 'ok'));

    positionMode = await signed(client, 'GET', '/fapi/v1/positionSide/dual').catch(error => ({ error: error.message || String(error) }));
    const oneWay = positionMode && !positionMode.error && String(positionMode.dualSidePosition) === 'false';
    checks.push(check('oneWayMode', 'account is in one-way position mode', oneWay, positionMode?.error || JSON.stringify(positionMode)));
  }

  const liveGate = client.env !== 'live' || liveUnlocked();
  checks.push(check('liveGate', 'live trading gate is locked unless explicitly confirmed', liveGate, client.env === 'live' ? 'live env' : 'not live'));

  const ok = checks.every(x => x.pass);
  return {
    ok,
    command: 'preflight',
    env: client.env,
    baseUrl: client.baseUrl,
    liveTradingLocked: client.env === 'live' && !liveUnlocked(),
    account: summarizeAccount(account),
    checks
  };
}

async function validateSampleOrder(client){
  await requireKeys(client);
  const symbol = String(args.symbol || process.env.TEST_ORDER_SYMBOL || 'BTCUSDT').toUpperCase();
  const side = normalizeOrderSide(args.side || process.env.TEST_ORDER_SIDE || 'BUY');
  const notional = number(args.notional || process.env.TEST_ORDER_NOTIONAL, client.env === 'live' ? Math.min(client.maxLiveOrderUsdt, 15) : 25);
  const order = await buildMarketOrder(client, symbol, side, notional);
  const result = await signed(client, 'POST', '/fapi/v1/order/test', order.params);
  await audit('validate-sample', client, { symbol, side, notional, quantity: order.params.quantity, endpoint: '/fapi/v1/order/test' });
  return {
    ok: true,
    command: 'validate-sample',
    env: client.env,
    submittedToMatchingEngine: false,
    order,
    result
  };
}

async function reconcile(client){
  await requireKeys(client);
  const [account, positions, openOrders] = await Promise.all([
    signed(client, 'GET', '/fapi/v3/account'),
    signed(client, 'GET', '/fapi/v3/positionRisk'),
    signed(client, 'GET', '/fapi/v1/openOrders')
  ]);
  const activePositions = (Array.isArray(positions) ? positions : [])
    .filter(p => Math.abs(number(p.positionAmt, 0)) > 0)
    .map(p => ({
      symbol: p.symbol,
      positionSide: p.positionSide,
      positionAmt: p.positionAmt,
      entryPrice: p.entryPrice,
      markPrice: p.markPrice,
      unrealizedProfit: p.unRealizedProfit,
      liquidationPrice: p.liquidationPrice,
      notional: p.notional,
      isolatedMargin: p.isolatedMargin
    }));
  const orders = Array.isArray(openOrders) ? openOrders.map(o => ({
    symbol: o.symbol,
    side: o.side,
    type: o.type,
    status: o.status,
    origQty: o.origQty,
    price: o.price,
    stopPrice: o.stopPrice,
    reduceOnly: o.reduceOnly,
    clientOrderId: o.clientOrderId
  })) : [];
  await audit('reconcile', client, { positions: activePositions.length, openOrders: orders.length });
  return {
    ok: true,
    command: 'reconcile',
    env: client.env,
    account: summarizeAccount(account),
    activePositions,
    openOrders: orders
  };
}

async function executeBracket(client){
  await requireKeys(client);
  const gate = await preflight(client);
  if(!gate.ok) throw new Error(`Preflight failed: ${gate.checks.filter(x => !x.pass).map(x => x.key).join(', ')}`);
  if(client.env === 'live' && !liveUnlocked()) throw new Error(`Live trading requires ALLOW_LIVE_TRADING=true and LIVE_CONFIRM_PHRASE=${LIVE_CONFIRM}`);

  const symbol = String(args.symbol || process.env.ORDER_SYMBOL || '').toUpperCase();
  if(!symbol) throw new Error('execute-bracket requires --symbol');
  const side = normalizeOrderSide(args.side || process.env.ORDER_SIDE || 'BUY');
  const notional = number(args.notional || process.env.ORDER_NOTIONAL, client.env === 'live' ? client.maxLiveOrderUsdt : 25);
  if(client.env === 'live' && notional > client.maxLiveOrderUsdt) throw new Error(`Live order notional ${notional} exceeds MAX_LIVE_ORDER_USDT ${client.maxLiveOrderUsdt}`);
  const tpPct = number(args.tp || process.env.ORDER_TP_PCT, 1.2);
  const slPct = number(args.sl || process.env.ORDER_SL_PCT, 0.45);
  if(tpPct <= 0 || slPct <= 0) throw new Error('TP and SL percentages must be positive');

  await ensureOneWayMode(client);
  await setIsolatedMargin(client, symbol);
  await setLeverage(client, symbol, Math.floor(number(args.leverage || process.env.ORDER_LEVERAGE, 1)));

  const entry = await buildMarketOrder(client, symbol, side, notional);
  const entryResponse = await signed(client, 'POST', '/fapi/v1/order', {
    ...entry.params,
    newOrderRespType: 'RESULT'
  });
  const avgPrice = number(entryResponse.avgPrice, entry.markPrice);
  const exitSide = side === 'BUY' ? 'SELL' : 'BUY';
  const tpStop = side === 'BUY' ? avgPrice * (1 + tpPct / 100) : avgPrice * (1 - tpPct / 100);
  const slStop = side === 'BUY' ? avgPrice * (1 - slPct / 100) : avgPrice * (1 + slPct / 100);
  const filters = await symbolFilters(client, symbol);
  const takeProfit = await signed(client, 'POST', '/fapi/v1/order', {
    symbol,
    side: exitSide,
    type: 'TAKE_PROFIT_MARKET',
    stopPrice: formatPrice(filters, tpStop),
    closePosition: 'true',
    workingType: 'MARK_PRICE',
    priceProtect: 'true',
    newClientOrderId: clientOrderId('mega_tp')
  });
  const stopLoss = await signed(client, 'POST', '/fapi/v1/order', {
    symbol,
    side: exitSide,
    type: 'STOP_MARKET',
    stopPrice: formatPrice(filters, slStop),
    closePosition: 'true',
    workingType: 'MARK_PRICE',
    priceProtect: 'true',
    newClientOrderId: clientOrderId('mega_sl')
  });
  await audit('execute-bracket', client, { symbol, side, notional, quantity: entry.params.quantity, avgPrice, tpPct, slPct });
  return {
    ok: true,
    command: 'execute-bracket',
    env: client.env,
    symbol,
    side,
    notional,
    entry: entryResponse,
    takeProfit,
    stopLoss
  };
}

async function killSwitch(client){
  await requireKeys(client);
  if(client.env === 'live' && process.env.KILL_SWITCH_CONFIRM !== KILL_CONFIRM){
    throw new Error(`Live kill switch requires KILL_SWITCH_CONFIRM=${KILL_CONFIRM}`);
  }
  const positions = await signed(client, 'GET', '/fapi/v3/positionRisk');
  const active = (Array.isArray(positions) ? positions : []).filter(p => Math.abs(number(p.positionAmt, 0)) > 0);
  const symbols = [...new Set(active.map(p => p.symbol))];
  const cancelled = [];
  for(const symbol of symbols){
    cancelled.push(await signed(client, 'DELETE', '/fapi/v1/allOpenOrders', { symbol }).catch(error => ({ symbol, error: error.message || String(error) })));
  }
  const closed = [];
  for(const pos of active){
    const amount = number(pos.positionAmt, 0);
    const side = amount > 0 ? 'SELL' : 'BUY';
    const filters = await symbolFilters(client, pos.symbol);
    const quantity = formatQty(filters, Math.abs(amount));
    closed.push(await signed(client, 'POST', '/fapi/v1/order', {
      symbol: pos.symbol,
      side,
      type: 'MARKET',
      quantity,
      reduceOnly: 'true',
      newOrderRespType: 'RESULT',
      newClientOrderId: clientOrderId('mega_kill')
    }).catch(error => ({ symbol: pos.symbol, error: error.message || String(error) })));
  }
  await audit('kill-switch', client, { positions: active.length, symbols });
  return { ok: true, command: 'kill-switch', env: client.env, cancelled, closed };
}

async function buildMarketOrder(client, symbol, side, notional){
  const filters = await symbolFilters(client, symbol);
  const markPrice = await markPrice(client, symbol);
  const quantity = formatQty(filters, notional / markPrice);
  const minNotional = number(filters.minNotional, 0);
  if(minNotional && number(quantity, 0) * markPrice < minNotional){
    throw new Error(`Order notional is below exchange minimum ${minNotional} USDT`);
  }
  return {
    markPrice,
    filters,
    params: {
      symbol,
      side,
      type: 'MARKET',
      quantity,
      newClientOrderId: clientOrderId('mega_test')
    }
  };
}

async function symbolFilters(client, symbol){
  const info = await signed(client, 'GET', '/fapi/v1/exchangeInfo', {}, { public: true });
  const item = (info.symbols || []).find(x => x.symbol === symbol);
  if(!item) throw new Error(`Unknown futures symbol ${symbol}`);
  const lot = item.filters.find(x => x.filterType === 'MARKET_LOT_SIZE') || item.filters.find(x => x.filterType === 'LOT_SIZE') || {};
  const price = item.filters.find(x => x.filterType === 'PRICE_FILTER') || {};
  const minNotional = item.filters.find(x => x.filterType === 'MIN_NOTIONAL') || {};
  return {
    symbol,
    quantityPrecision: item.quantityPrecision,
    pricePrecision: item.pricePrecision,
    stepSize: lot.stepSize || '1',
    minQty: lot.minQty || '0',
    tickSize: price.tickSize || '0.01',
    minNotional: minNotional.notional || minNotional.minNotional || '0'
  };
}

async function markPrice(client, symbol){
  const data = await signed(client, 'GET', '/fapi/v1/premiumIndex', { symbol }, { public: true });
  return number(Array.isArray(data) ? data[0]?.markPrice : data.markPrice, 0);
}

async function setIsolatedMargin(client, symbol){
  const res = await signed(client, 'POST', '/fapi/v1/marginType', { symbol, marginType: 'ISOLATED' })
    .catch(error => {
      if(String(error.message).includes('-4046')) return { ignored: 'already isolated' };
      throw error;
    });
  return res;
}

async function setLeverage(client, symbol, leverage){
  const lev = Math.min(3, Math.max(1, Math.floor(leverage || 1)));
  return signed(client, 'POST', '/fapi/v1/leverage', { symbol, leverage: lev });
}

async function ensureOneWayMode(client){
  const mode = await signed(client, 'GET', '/fapi/v1/positionSide/dual');
  if(String(mode.dualSidePosition) !== 'false'){
    throw new Error('Hedge Mode is not supported by this guarded executor. Switch to One-way Mode first.');
  }
}

async function signed(client, method, endpoint, params = {}, options = {}){
  const publicOnly = options.public;
  const input = { ...params };
  if(!publicOnly){
    await requireKeys(client);
    input.recvWindow = input.recvWindow || client.recvWindow;
    input.timestamp = Date.now();
  }
  const qs = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if(value !== undefined && value !== null && value !== '') qs.append(key, String(value));
  });
  if(!publicOnly){
    const signature = createHmac('sha256', client.apiSecret).update(qs.toString()).digest('hex');
    qs.append('signature', signature);
  }
  const query = qs.toString();
  const url = method === 'GET' || method === 'DELETE'
    ? `${client.baseUrl}${endpoint}${query ? `?${query}` : ''}`
    : `${client.baseUrl}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      accept: 'application/json',
      ...(publicOnly ? {} : { 'X-MBX-APIKEY': client.apiKey }),
      ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
    },
    body: method === 'POST' ? query : undefined
  });
  const text = await res.text();
  const body = text ? parseJson(text) : {};
  if(!res.ok || body?.code < 0){
    throw new Error(`${method} ${endpoint} failed: ${res.status} ${text}`);
  }
  return body;
}

async function loadPaperStatus(filePath){
  if(filePath.startsWith('http://') || filePath.startsWith('https://')){
    const res = await fetch(filePath, { cache: 'no-store' });
    if(!res.ok) return {};
    return res.json();
  }
  if(!existsSync(filePath)) return {};
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function audit(action, client, payload){
  await mkdir(path.dirname(EXEC_LOG_PATH), { recursive: true });
  const row = {
    time: new Date().toISOString(),
    action,
    env: client.env,
    payload
  };
  await writeFile(EXEC_LOG_PATH, `${JSON.stringify(row)}\n`, { flag: 'a' });
}

async function requireKeys(client){
  if(!client.apiKey || !client.apiSecret) throw new Error('BINANCE_API_KEY and BINANCE_API_SECRET are required');
}

function liveUnlocked(){
  return process.env.ALLOW_LIVE_TRADING === 'true' && process.env.LIVE_CONFIRM_PHRASE === LIVE_CONFIRM;
}

function summarizeAccount(account){
  if(!account || account.error) return account || null;
  return {
    totalWalletBalance: account.totalWalletBalance,
    availableBalance: account.availableBalance,
    totalMaintMargin: account.totalMaintMargin,
    totalUnrealizedProfit: account.totalUnrealizedProfit,
    assets: Array.isArray(account.assets) ? account.assets.filter(x => Number(x.walletBalance) || Number(x.availableBalance)).map(x => ({
      asset: x.asset,
      walletBalance: x.walletBalance,
      availableBalance: x.availableBalance
    })) : []
  };
}

function check(key, label, pass, detail = ''){
  return { key, label, pass: !!pass, detail };
}

function normalizeOrderSide(side){
  const value = String(side || '').toUpperCase();
  if(value !== 'BUY' && value !== 'SELL') throw new Error(`Order side must be BUY or SELL, got ${side}`);
  return value;
}

function clientOrderId(prefix){
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`.slice(0, 36);
}

function formatQty(filters, qty){
  return decimalFloor(qty, filters.stepSize, filters.quantityPrecision);
}

function formatPrice(filters, price){
  return decimalFloor(price, filters.tickSize, filters.pricePrecision);
}

function decimalFloor(value, step, precision){
  const n = number(value, 0);
  const stepNum = number(step, 0);
  const decimals = stepDecimals(step);
  const floored = stepNum > 0 ? Math.floor(n / stepNum) * stepNum : n;
  const fixed = floored.toFixed(Math.max(decimals, Number.isFinite(precision) ? precision : 0));
  return fixed.replace(/\.?0+$/, '');
}

function stepDecimals(step){
  const text = String(step);
  if(!text.includes('.')) return 0;
  return text.replace(/0+$/, '').split('.')[1]?.length || 0;
}

function parseJson(text){
  try{
    return JSON.parse(text);
  }catch{
    return { raw: text };
  }
}

function parseArgs(argv){
  const out = { _: [] };
  for(let i = 0; i < argv.length; i++){
    const arg = argv[i];
    if(arg.startsWith('--')){
      const key = arg.slice(2);
      const next = argv[i + 1];
      if(next && !next.startsWith('--')){
        out[key] = next;
        i++;
      }else{
        out[key] = true;
      }
    }else{
      out._.push(arg);
    }
  }
  return out;
}

function number(value, fallback){
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function print(value){
  console.log(JSON.stringify(value, null, 2));
}
