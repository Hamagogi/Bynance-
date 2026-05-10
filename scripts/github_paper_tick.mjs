import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const LOCAL_STATE = path.join(ROOT, 'data', 'github_paper_state.json');
const API_BASES = (process.env.BINANCE_API_BASES || [
  'https://fapi.binance.com/fapi/v1',
  'https://fapi1.binance.com/fapi/v1',
  'https://fapi2.binance.com/fapi/v1',
  'https://data-api.binance.vision/api/v3'
].join(','))
  .split(',')
  .map(x => x.trim().replace(/\/$/, ''))
  .filter(Boolean);
const FETCH_CONCURRENCY = Math.max(1, Math.floor(number(process.env.PAPER_FETCH_CONCURRENCY, 16)));

const DEFAULT_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'TONUSDT',
  'ONDOUSDT',
  'SUIUSDT'
];

const DEFAULT_SETTINGS = {
  capital: 3000,
  leverage: 3,
  feePct: 0.08,
  slipPct: 0.02,
  spreadPct: 0.04,
  funding8hPct: 0.01,
  marginPct: 14,
  maxPosition: 900,
  maxPositions: 4,
  minScore: 1.0,
  maxHoldMinutes: 360,
  intervals: ['3m', '5m', '15m'],
  candleLimit: 260,
  scanSymbolLimit: 0,
  fast: 8,
  slow: 21,
  pulse: 1.35,
  vwapLen: 96,
  breakout: 14,
  minAtr: 0.04,
  maxAtr: 4.2,
  tpPct: 2.8,
  slPct: 0.75,
  trailPct: 0.35,
  stopSlipMult: 1.35,
  maxDailyLossPct: 2,
  maxSameSidePositions: 2
};

const now = Date.now();

main().catch(async error => {
  await mkdir(PUBLIC_DIR, { recursive: true });
  const fallback = normalizeState(await loadPreviousState());
  fallback.running = true;
  fallback.lastUpdated = new Date(now).toISOString();
  fallback.errors.unshift(`[fatal] ${error.message || String(error)}`);
  trimState(fallback);
  await writeOutputs(fallback);
});

async function main(){
  await mkdir(PUBLIC_DIR, { recursive: true });
  await mkdir(path.dirname(LOCAL_STATE), { recursive: true });
  const state = normalizeState(await loadPreviousState());
  state.running = true;
  state.settings = readSettings(state.settings);
  state.errors = [];

  const symbols = await readSymbols(state);
  const market = await loadMarket(symbols, state.settings.intervals, state.settings.candleLimit, state.errors);

  updateOpenPositions(state, market);
  openNewPositions(state, market);
  markEquity(state);

  state.lastUpdated = new Date(now).toISOString();
  state.stats = makeStats(state);
  trimState(state);
  await writeOutputs(state);
}

async function readSymbols(state){
  if(process.env.PAPER_SYMBOLS){
    return parseSymbolList(process.env.PAPER_SYMBOLS);
  }
  const openSymbols = state.positions.map(p => p.symbol).filter(Boolean);
  const listed = await loadExchangeSymbols().catch(error => {
    state.errors.push(`[universe] ${error.message || String(error)}`);
    return DEFAULT_SYMBOLS;
  });
  const merged = [...new Set([...openSymbols, ...listed])];
  const limit = Math.max(0, Math.floor(state.settings.scanSymbolLimit || 0));
  return limit ? merged.slice(0, limit) : merged;
}

function readSettings(previous = {}){
  const intervals = (process.env.PAPER_INTERVALS || previous.intervals?.join(',') || DEFAULT_SETTINGS.intervals.join(','))
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
  return {
    ...DEFAULT_SETTINGS,
    ...previous,
    capital: number(process.env.PAPER_CAPITAL, previous.capital ?? DEFAULT_SETTINGS.capital),
    leverage: number(process.env.PAPER_LEVERAGE, previous.leverage ?? DEFAULT_SETTINGS.leverage),
    feePct: number(process.env.PAPER_FEE_PCT, previous.feePct ?? DEFAULT_SETTINGS.feePct),
    slipPct: number(process.env.PAPER_SLIP_PCT, previous.slipPct ?? DEFAULT_SETTINGS.slipPct),
    spreadPct: number(process.env.PAPER_SPREAD_PCT, previous.spreadPct ?? DEFAULT_SETTINGS.spreadPct),
    funding8hPct: number(process.env.PAPER_FUNDING_8H_PCT, previous.funding8hPct ?? DEFAULT_SETTINGS.funding8hPct),
    marginPct: number(process.env.PAPER_MARGIN_PCT, previous.marginPct ?? DEFAULT_SETTINGS.marginPct),
    maxPosition: number(process.env.PAPER_MAX_POSITION, previous.maxPosition ?? DEFAULT_SETTINGS.maxPosition),
    maxPositions: Math.floor(number(process.env.PAPER_MAX_POSITIONS, previous.maxPositions ?? DEFAULT_SETTINGS.maxPositions)),
    minScore: number(process.env.PAPER_MIN_SCORE, DEFAULT_SETTINGS.minScore),
    maxHoldMinutes: number(process.env.PAPER_MAX_HOLD_MINUTES, previous.maxHoldMinutes ?? DEFAULT_SETTINGS.maxHoldMinutes),
    candleLimit: Math.floor(number(process.env.PAPER_KLINES, previous.candleLimit ?? DEFAULT_SETTINGS.candleLimit)),
    scanSymbolLimit: Math.floor(number(process.env.PAPER_SCAN_SYMBOL_LIMIT, previous.scanSymbolLimit ?? DEFAULT_SETTINGS.scanSymbolLimit)),
    fast: Math.floor(number(process.env.PAPER_FAST_EMA, previous.fast ?? DEFAULT_SETTINGS.fast)),
    slow: Math.floor(number(process.env.PAPER_SLOW_EMA, previous.slow ?? DEFAULT_SETTINGS.slow)),
    pulse: number(process.env.PAPER_PULSE, previous.pulse ?? DEFAULT_SETTINGS.pulse),
    vwapLen: Math.floor(number(process.env.PAPER_VWAP_LEN, previous.vwapLen ?? DEFAULT_SETTINGS.vwapLen)),
    breakout: Math.floor(number(process.env.PAPER_BREAKOUT, previous.breakout ?? DEFAULT_SETTINGS.breakout)),
    minAtr: number(process.env.PAPER_MIN_ATR, previous.minAtr ?? DEFAULT_SETTINGS.minAtr),
    maxAtr: number(process.env.PAPER_MAX_ATR, previous.maxAtr ?? DEFAULT_SETTINGS.maxAtr),
    tpPct: number(process.env.PAPER_TP_PCT, previous.tpPct ?? DEFAULT_SETTINGS.tpPct),
    slPct: number(process.env.PAPER_SL_PCT, previous.slPct ?? DEFAULT_SETTINGS.slPct),
    trailPct: number(process.env.PAPER_TRAIL_PCT, previous.trailPct ?? DEFAULT_SETTINGS.trailPct),
    stopSlipMult: number(process.env.PAPER_STOP_SLIP_MULT, previous.stopSlipMult ?? DEFAULT_SETTINGS.stopSlipMult),
    maxDailyLossPct: number(process.env.PAPER_MAX_DAILY_LOSS_PCT, previous.maxDailyLossPct ?? DEFAULT_SETTINGS.maxDailyLossPct),
    maxSameSidePositions: Math.floor(number(process.env.PAPER_MAX_SAME_SIDE_POSITIONS, previous.maxSameSidePositions ?? DEFAULT_SETTINGS.maxSameSidePositions)),
    intervals
  };
}

async function loadExchangeSymbols(){
  const info = await fetchJsonFromBases('/exchangeInfo');
  const symbols = (info.symbols || [])
    .filter(x => x.status === 'TRADING')
    .filter(x => x.quoteAsset === 'USDT')
    .filter(x => !x.contractType || x.contractType === 'PERPETUAL')
    .map(x => x.symbol)
    .filter(isTradableUsdtSymbol);

  if(!symbols.length) return DEFAULT_SYMBOLS;

  const volumes = await loadQuoteVolumes().catch(() => new Map());
  return [...new Set(symbols)]
    .sort((a,b) => (volumes.get(b) || 0) - (volumes.get(a) || 0) || a.localeCompare(b));
}

async function loadQuoteVolumes(){
  const rows = await fetchJsonFromBases('/ticker/24hr');
  const volumes = new Map();
  if(!Array.isArray(rows)) return volumes;
  rows.forEach(row => {
    if(row?.symbol) volumes.set(row.symbol, number(row.quoteVolume, 0));
  });
  return volumes;
}

async function fetchJsonFromBases(pathname){
  const failures = [];
  for(const base of API_BASES){
    try{
      const res = await fetch(`${base}${pathname}`, { headers: { accept: 'application/json' } });
      if(!res.ok){
        failures.push(`${hostLabel(base)} HTTP ${res.status}`);
        continue;
      }
      return await res.json();
    }catch(error){
      failures.push(`${hostLabel(base)} ${error.message || String(error)}`);
    }
  }
  throw new Error(failures.join('; '));
}

function parseSymbolList(text){
  return [...new Set(String(text)
    .split(/[\s,]+/)
    .map(x => x.trim().toUpperCase())
    .filter(Boolean)
    .map(x => x.endsWith('USDT') ? x : `${x}USDT`)
    .filter(isTradableUsdtSymbol))];
}

function isTradableUsdtSymbol(symbol){
  return /^[A-Z0-9]+USDT$/.test(symbol)
    && !/(UP|DOWN|BULL|BEAR)USDT$/.test(symbol);
}

async function loadPreviousState(){
  if(existsSync(LOCAL_STATE)){
    try{
      return JSON.parse(await readFile(LOCAL_STATE, 'utf8'));
    }catch{}
  }

  const urls = previousStateUrls();
  for(const url of urls){
    try{
      const res = await fetch(url, { cache: 'no-store' });
      if(!res.ok) continue;
      const data = await res.json();
      return data.paper || data;
    }catch{}
  }
  return null;
}

function previousStateUrls(){
  if(process.env.PAPER_STATE_URL) return [process.env.PAPER_STATE_URL];
  if(!process.env.GITHUB_REPOSITORY) return [];
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  const base = repo === `${owner}.github.io`
    ? `https://${owner}.github.io`
    : `https://${owner}.github.io/${repo}`;
  return [`${base}/paper_status.json`];
}

function normalizeState(input){
  const s = input && typeof input === 'object' ? input : {};
  const settings = readSettings(s.settings);
  const initial = number(s.initial ?? s.startEquity, settings.capital);
  return {
    settings,
    running: true,
    cash: number(s.cash, initial),
    initial,
    positions: Array.isArray(s.positions) ? s.positions : [],
    journal: Array.isArray(s.journal) ? s.journal : [],
    equity: Array.isArray(s.equity) && s.equity.length ? s.equity : [{ time: now, value: initial }],
    stats: s.stats || {},
    errors: Array.isArray(s.errors) ? s.errors.slice(0, 12) : [],
    lastUpdated: s.lastUpdated || null
  };
}

async function loadMarket(symbols, intervals, limit, errors){
  const market = new Map();
  const jobs = [];
  for(const symbol of symbols){
    for(const interval of intervals){
      jobs.push(async () => {
        try{
          const candles = await fetchKlines(symbol, interval, limit);
          if(!market.has(symbol)) market.set(symbol, new Map());
          market.get(symbol).set(interval, candles);
        }catch(error){
          errors.push(`[${symbol} ${interval}] ${error.message || String(error)}`);
        }
      });
    }
  }
  let next = 0;
  const workers = Array.from({length: Math.min(FETCH_CONCURRENCY, jobs.length)}, async () => {
    while(next < jobs.length){
      const job = jobs[next++];
      await job();
    }
  });
  await Promise.all(workers);
  return market;
}

async function fetchKlines(symbol, interval, limit){
  const failures = [];
  for(const base of API_BASES){
    const url = `${base}/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    try{
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if(!res.ok){
        failures.push(`${hostLabel(base)} HTTP ${res.status}`);
        continue;
      }
      const rows = await res.json();
      if(!Array.isArray(rows) || rows.length < 80){
        failures.push(`${hostLabel(base)} not enough candles`);
        continue;
      }
      return rows.map(r => ({
        time: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
        quoteVolume: Number(r[7]),
        takerBuyQuote: Number(r[10])
      }));
    }catch(error){
      failures.push(`${hostLabel(base)} ${error.message || String(error)}`);
    }
  }
  throw new Error(failures.join('; '));
}

function hostLabel(base){
  try{
    return new URL(base).hostname;
  }catch{
    return base;
  }
}

function updateOpenPositions(state, market){
  const settings = state.settings;
  const remaining = [];
  for(const pos of state.positions){
    const candles = bestCandlesForPosition(market, pos);
    if(!candles.length){
      remaining.push(pos);
      continue;
    }
    const candle = closedCandles(candles).at(-1);
    pos.mark = candle.close;
    trailPosition(pos, candles);

    const hitLiq = pos.liq ? (pos.side === 'LONG' ? candle.low <= pos.liq : candle.high >= pos.liq) : false;
    const hitTp = pos.side === 'LONG' ? candle.high >= pos.tp : candle.low <= pos.tp;
    const hitSl = pos.side === 'LONG' ? candle.low <= pos.sl : candle.high >= pos.sl;
    const ageMinutes = (now - (pos.openedAt || now)) / 60000;
    const timedOut = ageMinutes >= settings.maxHoldMinutes;

    if(hitLiq || hitSl || hitTp || timedOut){
      const reason = hitLiq ? 'LIQ' : hitSl ? 'SL' : hitTp ? 'TP' : 'TIME';
      const exit = hitLiq ? pos.liq : hitSl ? pos.sl : hitTp ? pos.tp : candle.close;
      closePosition(state, pos, exit, reason);
    }else{
      remaining.push(pos);
    }
  }
  state.positions = remaining;
}

function bestCandlesForPosition(market, pos){
  return market.get(pos.symbol)?.get(pos.interval || '5m') || [...(market.get(pos.symbol)?.values() || [])][0] || [];
}

function openNewPositions(state, market){
  const settings = state.settings;
  if(equityNow(state) <= state.initial * (1 - settings.maxDailyLossPct / 100)){
    state.errors.unshift(`[risk] daily loss guard: equity below -${settings.maxDailyLossPct}%`);
    return;
  }
  const openSymbols = new Set(state.positions.map(p => p.symbol));
  const capacity = Math.max(0, settings.maxPositions - state.positions.length);
  if(!capacity) return;

  const candidates = [];
  for(const [symbol, intervals] of market.entries()){
    if(openSymbols.has(symbol)) continue;
    let best = null;
    for(const [interval, candles] of intervals.entries()){
      const signal = scoreSignal(symbol, interval, candles, settings);
      if(signal && (!best || signal.score > best.score)) best = signal;
    }
    if(best && best.score >= settings.minScore) candidates.push(best);
  }

  candidates.sort((a,b) => b.score - a.score);
  for(const signal of candidates){
    if(state.positions.length >= settings.maxPositions) break;
    if(state.positions.filter(p => p.side === signal.side).length >= settings.maxSameSidePositions) continue;
    openPosition(state, signal);
  }
}

function scoreSignal(symbol, interval, candles, settings){
  const c = closedCandles(candles);
  const warm = Math.max(settings.slow + 2, settings.vwapLen + 2, settings.breakout + 2, 80);
  if(c.length < warm + 2) return null;
  const ind = indicators(c, settings);
  const i = c.length - 1;
  const side = entryDirection(c, ind, i, settings);
  if(!side) return null;
  const last = c.at(-1);
  const score = signalScore(c, ind, i, settings, side);
  if(score < settings.minScore) return null;
  const entry = last.close;
  const tp = side === 'LONG' ? entry * (1 + settings.tpPct / 100) : entry * (1 - settings.tpPct / 100);
  const sl = side === 'LONG' ? entry * (1 - settings.slPct / 100) : entry * (1 + settings.slPct / 100);
  return {
    symbol,
    interval,
    side,
    score,
    entry,
    mark: entry,
    atr: ind.atr[i],
    atrPct: ind.atr[i] / entry * 100,
    tp,
    sl,
    trailPct: settings.trailPct,
    reason: `${interval} shared-strategy score ${score.toFixed(2)}`
  };
}

function openPosition(state, signal){
  const settings = state.settings;
  const equity = equityNow(state);
  const order = Math.min(settings.maxPosition, equity * settings.marginPct / 100 * settings.leverage);
  if(order < 10) return;
  const margin = order / settings.leverage;
  if(state.cash < margin) return;
  const entry = entryFillPrice(signal.entry, signal.side, settings);
  const liqAdverse = liquidationAdversePct(settings.leverage);
  const pos = {
    id: `${signal.symbol}-${signal.interval}-${now}`,
    symbol: signal.symbol,
    interval: signal.interval,
    side: signal.side,
    leverage: settings.leverage,
    entry,
    mark: signal.entry,
    margin,
    order,
    tp: signal.side === 'LONG' ? entry * (1 + settings.tpPct / 100) : entry * (1 - settings.tpPct / 100),
    sl: signal.side === 'LONG' ? entry * (1 - settings.slPct / 100) : entry * (1 + settings.slPct / 100),
    liq: signal.side === 'LONG' ? entry * (1 - liqAdverse / 100) : entry * (1 + liqAdverse / 100),
    openedAt: now,
    score: signal.score,
    marginReserved: true,
    trailPct: settings.trailPct,
    strategy: 'Shared EMA/VWAP/ATR',
    reason: signal.reason
  };
  state.cash = Math.max(0, state.cash - margin);
  state.positions.push(pos);
  state.journal.unshift({
    time: now,
    symbol: pos.symbol,
    side: pos.side,
    action: 'OPEN',
    price: pos.entry,
    pnl: 0,
    reason: pos.reason
  });
}

function closePosition(state, pos, price, reason){
  const exit = reason === 'LIQ' ? price : exitFillPrice(price, pos.side, state.settings, reason === 'SL' ? state.settings.stopSlipMult : 1);
  const ret = markRetPct(pos.entry, exit, pos.side) - state.settings.feePct - fundingCostPct(pos.openedAt, now, state.settings);
  const pnl = reason === 'LIQ' ? -Math.min(pos.margin, pos.margin * 1.002) : pos.order * ret / 100;
  const release = pos.marginReserved ? pos.margin : 0;
  state.cash = Math.max(0, state.cash + release + pnl);
  state.journal.unshift({
    time: now,
    symbol: pos.symbol,
    side: pos.side,
    action: 'CLOSE',
    price: exit,
    pnl,
    ret,
    reason
  });
}

function trailPosition(pos, candles){
  const c = closedCandles(candles);
  if(c.length < 30) return;
  const a = atr(c, 14);
  const last = c.at(-1);
  if(pos.side === 'LONG'){
    const nextSl = last.close - a * 1.25;
    if(nextSl > pos.entry && nextSl > pos.sl) pos.sl = nextSl;
  }else{
    const nextSl = last.close + a * 1.25;
    if(nextSl < pos.entry && nextSl < pos.sl) pos.sl = nextSl;
  }
}

function markEquity(state){
  state.equity.push({ time: now, value: equityNow(state) });
}

function equityNow(state){
  return state.cash + state.positions.reduce((sum, pos) => {
    const ret = markRetPct(pos.entry, pos.mark || pos.entry, pos.side) - state.settings.feePct;
    return sum + (pos.marginReserved ? pos.margin : 0) + pos.order * ret / 100;
  }, 0);
}

function makeStats(state){
  const closed = state.journal.filter(x => x.action === 'CLOSE');
  const wins = closed.filter(x => x.pnl >= 0);
  const losses = closed.filter(x => x.pnl < 0);
  const grossWin = wins.reduce((s,x) => s + x.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s,x) => s + x.pnl, 0));
  return {
    returnPct: (equityNow(state) / state.initial - 1) * 100,
    closedTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length * 100 : 0,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? 99 : 0,
    maxDrawdownPct: maxDrawdown(state.equity.map(x => x.value)),
    updatedAt: state.lastUpdated
  };
}

function maxDrawdown(values){
  let peak = values[0] || 0;
  let dd = 0;
  for(const value of values){
    peak = Math.max(peak, value);
    if(peak > 0) dd = Math.max(dd, (peak - value) / peak * 100);
  }
  return dd;
}

async function writeOutputs(state){
  const paper = toPaper(state);
  const payload = {
    ok: true,
    generatedAt: new Date(now).toISOString(),
    source: 'github-actions',
    paper
  };
  await writeFile(path.join(PUBLIC_DIR, 'paper_status.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await writeFile(LOCAL_STATE, `${JSON.stringify(paper, null, 2)}\n`, 'utf8');
  if(existsSync(path.join(ROOT, 'binance_lab.html'))){
    await copyFile(path.join(ROOT, 'binance_lab.html'), path.join(PUBLIC_DIR, 'binance_lab.html'));
    await copyFile(path.join(ROOT, 'binance_lab.html'), path.join(PUBLIC_DIR, 'index.html'));
  }else{
    await writeFile(path.join(PUBLIC_DIR, 'index.html'), fallbackDashboardHtml(), 'utf8');
  }
}

function fallbackDashboardHtml(){
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Binance Paper Lab</title>
  <style>
    :root{color-scheme:dark;--bg:#090d12;--panel:#101820;--line:#243241;--text:#eef7f8;--muted:#8da0ad;--good:#30d889;--bad:#ff657a;--cyan:#22c7d8}
    *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:1180px;margin:0 auto;padding:28px 18px 48px} header{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;border-bottom:1px solid var(--line);padding-bottom:18px}
    h1{margin:0;font-size:30px;letter-spacing:0}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin:18px 0}
    .card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px}.label{font-size:12px;color:var(--muted)}.value{font-size:23px;font-weight:800;margin-top:6px}.good{color:var(--good)}.bad{color:var(--bad)}
    table{width:100%;border-collapse:collapse;margin-top:10px}th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;font-size:14px}th{color:var(--muted);font-weight:600}
    canvas{width:100%;height:280px;background:#0b1117;border:1px solid var(--line);border-radius:8px;margin-top:16px}.section{margin-top:22px}.pill{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:5px 9px;color:var(--muted)}
    @media(max-width:800px){header{display:block}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}th,td{font-size:12px;padding:8px}.wide{grid-column:1/-1}}
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Binance Paper Lab</h1>
        <div class="muted">GitHub Actions refreshes Binance Futures public market data every 5 minutes.</div>
      </div>
      <div class="pill" id="updated">loading</div>
    </header>
    <section class="grid">
      <div class="card"><div class="label">Equity</div><div class="value" id="equity">-</div></div>
      <div class="card"><div class="label">Return</div><div class="value" id="ret">-</div></div>
      <div class="card"><div class="label">Open</div><div class="value" id="open">-</div></div>
      <div class="card"><div class="label">Win Rate</div><div class="value" id="win">-</div></div>
      <div class="card wide"><div class="label">Profit Factor</div><div class="value" id="pf">-</div></div>
    </section>
    <canvas id="chart" width="1100" height="280"></canvas>
    <section class="section card">
      <h2>Open Positions</h2>
      <table><thead><tr><th>Symbol</th><th>Side</th><th>Interval</th><th>Entry</th><th>Mark</th><th>TP</th><th>SL</th><th>Score</th></tr></thead><tbody id="positions"></tbody></table>
    </section>
    <section class="section card">
      <h2>Journal</h2>
      <table><thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Action</th><th>Price</th><th>PNL</th><th>Reason</th></tr></thead><tbody id="journal"></tbody></table>
    </section>
    <section class="section card">
      <h2>Errors</h2>
      <div class="muted" id="errors">-</div>
    </section>
  </main>
  <script>
    const $ = id => document.getElementById(id);
    const money = n => '$' + Number(n || 0).toLocaleString('en-US',{maximumFractionDigits:2});
    const pct = n => Number(n || 0).toFixed(2) + '%';
    const num = n => Number(n || 0).toLocaleString('en-US',{maximumFractionDigits:6});
    async function load(){
      const res = await fetch('paper_status.json?t=' + Date.now(), {cache:'no-store'});
      const data = await res.json();
      const p = data.paper;
      const last = p.equity.at(-1)?.value || p.initial;
      const s = p.stats || {};
      $('updated').textContent = p.lastUpdated ? new Date(p.lastUpdated).toLocaleString('ko-KR') : 'waiting';
      $('equity').textContent = money(last);
      $('ret').textContent = pct(s.returnPct);
      $('ret').className = 'value ' + (s.returnPct >= 0 ? 'good' : 'bad');
      $('open').textContent = p.positions.length;
      $('win').textContent = pct(s.winRate);
      $('pf').textContent = Number(s.profitFactor || 0).toFixed(2);
      $('positions').innerHTML = p.positions.map(x => '<tr><td>'+x.symbol+'</td><td>'+x.side+'</td><td>'+x.interval+'</td><td>'+num(x.entry)+'</td><td>'+num(x.mark)+'</td><td>'+num(x.tp)+'</td><td>'+num(x.sl)+'</td><td>'+Number(x.score||0).toFixed(2)+'</td></tr>').join('') || '<tr><td colspan="8" class="muted">No open positions</td></tr>';
      $('journal').innerHTML = p.journal.slice(0,40).map(x => '<tr><td>'+new Date(x.time).toLocaleString('ko-KR')+'</td><td>'+x.symbol+'</td><td>'+x.side+'</td><td>'+x.action+'</td><td>'+num(x.price)+'</td><td class="'+(x.pnl>=0?'good':'bad')+'">'+money(x.pnl)+'</td><td>'+String(x.reason||'')+'</td></tr>').join('');
      $('errors').textContent = (p.errors || []).join(' / ') || '-';
      draw(p.equity.map(x => x.value));
    }
    function draw(values){
      const c = $('chart'), ctx = c.getContext('2d'), w = c.width, h = c.height, pad = 28;
      ctx.clearRect(0,0,w,h); ctx.strokeStyle = '#243241'; ctx.strokeRect(0,0,w,h);
      if(values.length < 2) return;
      const min = Math.min(...values), max = Math.max(...values), span = Math.max(1, max-min);
      ctx.beginPath(); ctx.strokeStyle = '#22c7d8'; ctx.lineWidth = 2;
      values.forEach((v,i) => { const x = pad + i/(values.length-1)*(w-pad*2); const y = h-pad-(v-min)/span*(h-pad*2); i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); });
      ctx.stroke();
    }
    load(); setInterval(load, 60000);
  </script>
</body>
</html>`;
}

function toPaper(state){
  return {
    settings: state.settings,
    running: state.running,
    lastUpdated: state.lastUpdated,
    cash: round(state.cash),
    initial: round(state.initial),
    positions: state.positions.map(p => ({
      ...p,
      entry: round(p.entry),
      mark: round(p.mark),
      margin: round(p.margin),
      order: round(p.order),
      tp: round(p.tp),
      sl: round(p.sl),
      score: round(p.score, 3)
    })),
    journal: state.journal,
    equity: state.equity.map(x => ({ time: x.time, value: round(x.value) })),
    stats: state.stats,
    errors: state.errors
  };
}

function trimState(state){
  state.positions = state.positions.slice(0, state.settings.maxPositions);
  state.journal = state.journal.slice(0, 240);
  state.equity = state.equity.slice(-1200);
  state.errors = state.errors.slice(0, 20);
}

function closedCandles(candles){
  return candles.length > 2 ? candles.slice(0, -1) : candles;
}

function indicators(candles, p){
  const closes = candles.map(c => c.close);
  return {
    emaFast: ema(closes, p.fast),
    emaSlow: ema(closes, p.slow),
    atr: atrSeries(candles, 14),
    vwap: rollingVWAP(candles, p.vwapLen),
    avgQuote: rollingAvg(candles.map(c => c.quoteVolume || c.volume * c.close), 20),
    high: rollingHigh(candles.map(c => c.high), p.breakout),
    low: rollingLow(candles.map(c => c.low), p.breakout)
  };
}

function entry(candles, ind, i, p, side){
  const c = candles[i], prev = candles[i - 1];
  if(!c || !prev) return false;
  const quote = c.quoteVolume || c.volume * c.close;
  const takerBuy = c.takerBuyQuote || quote * .5;
  const atrPct = c.close ? ind.atr[i] / c.close * 100 : 0;
  const pulse = ind.avgQuote[i - 1] ? quote / ind.avgQuote[i - 1] : 1;
  const buyRatio = quote ? takerBuy / quote : .5;
  const longTrend = c.close > ind.emaFast[i] && ind.emaFast[i] > ind.emaSlow[i] && c.close > ind.vwap[i];
  const shortTrend = c.close < ind.emaFast[i] && ind.emaFast[i] < ind.emaSlow[i] && c.close < ind.vwap[i];
  const baseOk = pulse >= p.pulse && atrPct >= p.minAtr && atrPct <= p.maxAtr;
  if(side === 'LONG'){
    if(!baseOk || !longTrend || buyRatio < .50 || c.close <= c.open) return false;
    if(prev.low <= ind.emaFast[i - 1] * 1.002 && c.close > ind.emaFast[i]) return true;
    return c.close > ind.high[i - 1] * 1.0002 && closeNearHigh(c);
  }
  if(!baseOk || !shortTrend || buyRatio > .50 || c.close >= c.open) return false;
  if(prev.high >= ind.emaFast[i - 1] * .998 && c.close < ind.emaFast[i]) return true;
  return c.close < ind.low[i - 1] * .9998 && closeNearLow(c);
}

function entryDirection(candles, ind, i, p){
  const longHit = entry(candles, ind, i, p, 'LONG');
  const shortHit = entry(candles, ind, i, p, 'SHORT');
  if(longHit && shortHit) return directionBias(candles, ind, i) >= 0 ? 'LONG' : 'SHORT';
  return longHit ? 'LONG' : shortHit ? 'SHORT' : null;
}

function directionBias(candles, ind, i){
  const c = candles[i], prev = candles[i - 1];
  if(!c || !prev || !c.close) return 0;
  return (ind.emaFast[i] - ind.emaSlow[i]) / c.close * 100 +
    (c.close - ind.vwap[i]) / c.close * 100 +
    (c.close - c.open) / c.open * 100 +
    (c.close - prev.close) / prev.close * 100;
}

function signalScore(candles, ind, i, p, side){
  const c = candles[i];
  const quote = c.quoteVolume || c.volume * c.close;
  const pulse = ind.avgQuote[i - 1] ? quote / ind.avgQuote[i - 1] : 1;
  const atrPct = c.close ? ind.atr[i] / c.close * 100 : 0;
  const trendGap = Math.abs(ind.emaFast[i] - ind.emaSlow[i]) / c.close * 100;
  const vwapGap = Math.abs(c.close - ind.vwap[i]) / c.close * 100;
  return 1 + Math.min(2, pulse / Math.max(.01, p.pulse)) + Math.min(1.5, atrPct) + Math.min(1, trendGap + vwapGap) + (side === 'LONG' ? .05 : 0);
}

function executionHalfSpreadPct(settings){ return Math.max(0, number(settings.spreadPct, 0)) / 2; }
function entryFillPrice(price, side, settings){
  const cost = (Math.max(0, number(settings.slipPct, 0)) + executionHalfSpreadPct(settings)) / 100;
  return side === 'LONG' ? price * (1 + cost) : price * (1 - cost);
}
function exitFillPrice(price, side, settings, slipMult = 1){
  const cost = (Math.max(0, number(settings.slipPct, 0)) * Math.max(1, slipMult) + executionHalfSpreadPct(settings)) / 100;
  return side === 'LONG' ? price * (1 - cost) : price * (1 + cost);
}
function fundingCostPct(entryTime, exitTime, settings){
  const hours = Math.max(0, (Number(exitTime) || 0) - (Number(entryTime) || 0)) / 3600000;
  return hours / 8 * Math.max(0, number(settings.funding8hPct, 0));
}
function liquidationAdversePct(leverage){ return Math.max(.05, 100 / Math.max(1, leverage) - .85); }

function markRetPct(entry, price, side){
  const raw = (price / entry - 1) * 100;
  return side === 'SHORT' ? -raw : raw;
}

function ema(values, period){
  const k = 2 / (period + 1);
  const out = [];
  let prev = values[0];
  for(const value of values){
    prev = value * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsi(values, period){
  let gain = 0;
  let loss = 0;
  for(let i = values.length - period; i < values.length; i++){
    const diff = values[i] - values[i - 1];
    if(diff >= 0) gain += diff;
    else loss -= diff;
  }
  if(loss === 0) return 100;
  const rs = gain / period / (loss / period);
  return 100 - 100 / (1 + rs);
}

function atr(candles, period){
  const trs = [];
  for(let i = 1; i < candles.length; i++){
    const c = candles[i];
    const p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return sma(trs.slice(-period));
}

function atrSeries(candles, period){
  const out = [];
  for(let i = 0; i < candles.length; i++){
    if(i === 0){ out.push(0); continue; }
    const start = Math.max(1, i - period + 1);
    const trs = [];
    for(let j = start; j <= i; j++){
      const c = candles[j];
      const p = candles[j - 1];
      trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    }
    out.push(sma(trs));
  }
  return out;
}

function rollingAvg(values, len){
  const out = [];
  let sum = 0;
  for(let i = 0; i < values.length; i++){
    sum += values[i] || 0;
    if(i >= len) sum -= values[i - len] || 0;
    out.push(sum / Math.min(len, i + 1));
  }
  return out;
}

function rollingHigh(values, len){
  return values.map((_, i) => Math.max(...values.slice(Math.max(0, i - len + 1), i + 1)));
}

function rollingLow(values, len){
  return values.map((_, i) => Math.min(...values.slice(Math.max(0, i - len + 1), i + 1)));
}

function rollingVWAP(candles, len){
  return candles.map((_, i) => {
    const rows = candles.slice(Math.max(0, i - len + 1), i + 1);
    const vol = rows.reduce((s,c) => s + (c.volume || 0), 0);
    if(!vol) return candles[i].close;
    return rows.reduce((s,c) => s + ((c.high + c.low + c.close) / 3) * (c.volume || 0), 0) / vol;
  });
}

function sma(values){
  if(!values.length) return 0;
  return values.reduce((s,x) => s + x, 0) / values.length;
}

function closeNearHigh(c){ return (c.high - c.close) / Math.max(1e-9, c.high - c.low) <= .25; }
function closeNearLow(c){ return (c.close - c.low) / Math.max(1e-9, c.high - c.low) <= .25; }

function number(value, fallback){
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 6){
  const n = Number(value);
  if(!Number.isFinite(n)) return 0;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}
