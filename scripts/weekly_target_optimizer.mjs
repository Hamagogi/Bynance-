import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const API = 'https://fapi.binance.com/fapi/v1';

const SETTINGS = {
  capital: 1000000,
  feePct: Number(process.env.FEE_PCT || 0.08),
  slipPct: Number(process.env.SLIP_PCT || 0.02),
  spreadPct: Number(process.env.SPREAD_PCT || 0.04),
  funding8hPct: Number(process.env.FUNDING_8H_PCT || 0.01),
  marginPct: Number(process.env.MARGIN_PCT || 18),
  maxPosition: Number(process.env.MAX_POSITION || 320000),
  minLiqBuffer: 0.45,
  cooldown: 2,
  maxDd: Number(process.env.MAX_DD || 8),
  minPf: 1.25,
  minTrades: 10,
  rejectLiq: true,
  mtmDd: true,
  targetWeeklyPct: 10,
  symbolLimit: Number(process.env.SYMBOL_LIMIT ?? 0),
  candleLimit: Number(process.env.CANDLE_LIMIT || 1500),
  requestDelayMs: Number(process.env.REQUEST_DELAY_MS || 350),
  intervals: (process.env.INTERVALS || '3m,5m,15m').split(',').map(x => x.trim()).filter(Boolean),
  leverages: (process.env.LEVERAGES || '2,3,4,5').split(',').map(Number).filter(Boolean)
};

const BASE_CANDIDATES = [
  {id:'balanced-flow', interval:'5m', mode:'pullback', fast:8, slow:21, pulse:1.35, vwapLen:96, breakout:18, minAtr:.06, maxAtr:2.8, tp:1.6, sl:.55, trail:.35, maxHold:24},
  {id:'micro-flow', interval:'1m', mode:'impulse', fast:5, slow:13, pulse:1.9, vwapLen:90, breakout:18, minAtr:.05, maxAtr:2.6, tp:.72, sl:.28, trail:.18, maxHold:18},
  {id:'micro-reclaim', interval:'1m', mode:'reclaim', fast:8, slow:21, pulse:1.35, vwapLen:120, breakout:14, minAtr:.04, maxAtr:2.4, tp:.64, sl:.24, trail:.16, maxHold:16},
  {id:'compression-breakout', interval:'3m', mode:'impulse', fast:5, slow:13, pulse:1.8, vwapLen:64, breakout:20, minAtr:.10, maxAtr:3.5, tp:1.15, sl:.42, trail:.25, maxHold:12},
  {id:'vwap-reclaim', interval:'5m', mode:'reclaim', fast:8, slow:21, pulse:1.12, vwapLen:144, breakout:14, minAtr:.04, maxAtr:2.2, tp:1.05, sl:.38, trail:.25, maxHold:18},
  {id:'slow-trend', interval:'15m', mode:'pullback', fast:12, slow:34, pulse:1.10, vwapLen:96, breakout:24, minAtr:.05, maxAtr:1.8, tp:2.2, sl:.75, trail:.50, maxHold:48},
  {id:'failure-breakout', interval:'5m', mode:'breakout', fast:8, slow:21, pulse:1.45, vwapLen:96, breakout:30, minAtr:.08, maxAtr:3.0, tp:1.35, sl:.50, trail:.30, maxHold:16},
  {id:'vwap-fade', interval:'5m', mode:'meanrevert', fast:8, slow:21, pulse:1.08, vwapLen:96, breakout:18, minAtr:.04, maxAtr:2.6, tp:.82, sl:.34, trail:.16, maxHold:10, minTrendBase:.01, minBodyBase:.18, maxVwapDistBase:3.4, minLongBuyRatio:.38, maxShortBuyRatio:.62, minRsiLong:18, maxRsiLong:44, minRsiShort:56, maxRsiShort:82},
  {id:'exhaustion-fade', interval:'3m', mode:'meanrevert', fast:5, slow:13, pulse:1.38, vwapLen:72, breakout:16, minAtr:.07, maxAtr:3.2, tp:.94, sl:.38, trail:.18, maxHold:9, minTrendBase:.01, minBodyBase:.20, maxVwapDistBase:3.8, minLongBuyRatio:.36, maxShortBuyRatio:.64, minRsiLong:16, maxRsiLong:42, minRsiShort:58, maxRsiShort:84}
];

const VARIANTS = [
  {id:'balanced', pulse:0, tp:1, sl:1, trail:1, hold:1, breakout:0, minTrend:1, minBody:1, maxVwapDist:1},
  {id:'early', pulse:-.18, tp:.78, sl:.78, trail:.78, hold:.65, breakout:-5, minTrend:.8, minBody:.88, maxVwapDist:1.12},
  {id:'confirm', pulse:.28, tp:1.12, sl:.9, trail:1.04, hold:1.05, breakout:5, minTrend:1.3, minBody:1.16, maxVwapDist:.84},
  {id:'runner', pulse:.12, tp:1.55, sl:1.08, trail:1.22, hold:1.55, breakout:2, minTrend:1.18, minBody:1.08, maxVwapDist:1.18},
  {id:'scalp-tight', pulse:.45, tp:.62, sl:.58, trail:.7, hold:.45, breakout:7, minTrend:1.45, minBody:1.25, maxVwapDist:.7}
];

function buildParamGrid(){
  const rows = [];
  for(const b of BASE_CANDIDATES){
    for(const v of VARIANTS){
      rows.push({
        ...b,
        id:`${b.id}-${v.id}`,
        pulse:round(Math.max(1.01, b.pulse + v.pulse)),
        tp:round(Math.max(.25, b.tp * v.tp)),
        sl:round(Math.max(.18, b.sl * v.sl)),
        trail:round(Math.max(0, b.trail * v.trail)),
        maxHold:Math.max(4, Math.round(b.maxHold * v.hold)),
        breakout:Math.max(8, Math.round(b.breakout + v.breakout)),
        minTrend:round((b.minTrendBase ?? .035) * v.minTrend),
        minBody:round((b.minBodyBase ?? .34) * v.minBody),
        maxVwapDist:round((b.maxVwapDistBase ?? 2.4) * v.maxVwapDist),
        minLongBuyRatio:b.minLongBuyRatio ?? (v.id === 'confirm' || v.id === 'scalp-tight' ? .55 : v.id === 'runner' ? .54 : .52),
        maxShortBuyRatio:b.maxShortBuyRatio ?? (v.id === 'confirm' || v.id === 'scalp-tight' ? .45 : v.id === 'runner' ? .46 : .48),
        minRsiLong:b.minRsiLong ?? 44,
        maxRsiLong:b.maxRsiLong ?? (v.id === 'runner' ? 82 : 78),
        minRsiShort:b.minRsiShort ?? (v.id === 'runner' ? 18 : 22),
        maxRsiShort:b.maxRsiShort ?? 56
      });
    }
  }
  return dedupe(rows);
}

async function main(){
  const symbols = await topSymbols(SETTINGS.symbolLimit);
  const paramsList = buildParamGrid();
  const results = [];
  const bestBySymbol = new Map();
  const targetBySymbol = new Map();
  let done = 0;
  const total = symbols.length * SETTINGS.intervals.length;
  for(const symbol of symbols){
    for(const interval of SETTINGS.intervals){
      done++;
      process.stderr.write(`\r[${done}/${total}] ${symbol} ${interval}          `);
      let candles;
      try{
        candles = await klines(symbol, interval, SETTINGS.candleLimit);
      }catch(err){
        if(isRateLimit(err)){
          emitReport(buildReport(symbols, results, bestBySymbol, targetBySymbol, {
            aborted:true,
            abortReason:err.message,
            stoppedAt:{symbol, interval, done, total}
          }));
          return;
        }
        continue;
      }
      if(candles.length < 260) continue;
      const splitTrain = Math.floor(candles.length * .55);
      const splitValidation = Math.floor(candles.length * .78);
      for(const params of paramsList.filter(p => p.interval === interval)){
        const ind = indicators(candles, params);
        for(const side of ['BOTH','LONG','SHORT']){
          for(const leverage of SETTINGS.leverages){
            const train = backtest(candles, params, side, leverage, SETTINGS, 0, splitTrain, false, ind);
            if(train.trades < Math.max(2, Math.floor(SETTINGS.minTrades * .35))) continue;
            const test = backtest(candles, params, side, leverage, SETTINGS, splitTrain, splitValidation, false, ind);
            const final = backtest(candles, params, side, leverage, SETTINGS, splitValidation, candles.length, false, ind);
            const all = backtest(candles, params, side, leverage, SETTINGS, 0, candles.length, false, ind);
            const row = decorate(symbol, interval, candles, params, side, leverage, train, test, final, all, SETTINGS);
            if(row.targetPass) attachStressResult(row, candles, params, side, leverage, SETTINGS, ind);
            if(row.score > -100) {
              results.push(row);
              updateBest(bestBySymbol, symbol, row);
              if(row.targetPass) updateBest(targetBySymbol, symbol, row);
            }
          }
        }
      }
      results.sort(compareResults);
      results.splice(180);
      emitReport(buildReport(symbols, results, bestBySymbol, targetBySymbol, {
        partial:true,
        stoppedAt:{symbol, interval, done, total}
      }), true);
      await sleep(SETTINGS.requestDelayMs);
    }
  }
  process.stderr.write('\n');
  emitReport(buildReport(symbols, results, bestBySymbol, targetBySymbol, {
    aborted:false,
    completed:true
  }));
}

function buildReport(symbols, rows, bestBySymbol, targetBySymbol, meta={}){
  const results = rows.slice().sort(compareResults);
  const top = results.slice(0, 20);
  results.sort(compareResults);
  const coverage = symbols.map(symbol => {
    const target = targetBySymbol.get(symbol) || null;
    const best = bestBySymbol.get(symbol) || null;
    return {
      symbol,
      pass:!!target,
      target,
      best,
      bestWeekly:best ? best.finalWeeklyPct : null,
      bestAllWeekly:best ? best.allWeeklyPct : null
    };
  });
  const pass = coverage.filter(r => r.pass).map(r => r.target).sort(compareResults);
  const missing = coverage.filter(r => !r.pass).map(r => ({
    symbol:r.symbol,
    bestWeekly:r.bestWeekly,
    bestAllWeekly:r.bestAllWeekly,
    best:r.best ? {
      interval:r.best.interval,
      side:r.best.side,
      leverage:r.best.leverage,
      params:r.best.params.id,
      finalWeeklyPct:r.best.finalWeeklyPct,
      allWeeklyPct:r.best.allWeeklyPct,
      returnPct:r.best.all.returnPct,
      maxDd:r.best.all.maxDd,
      trades:r.best.all.trades,
      pf:r.best.all.pf,
      validationPass:r.best.validationPass,
      finalPass:r.best.finalPass
    } : null
  }));
  const report = {
    generatedAt:new Date().toISOString(),
    ...meta,
    settings:SETTINGS,
    symbols,
    best:top[0] || null,
    coverageCount:symbols.length,
    coveragePassCount:pass.length,
    coveragePassPct:symbols.length ? pass.length / symbols.length * 100 : 0,
    allSymbolsTargetPass:pass.length === symbols.length,
    missingCount:missing.length,
    missingSymbols:missing,
    passedSymbols:pass.map(r => ({
      symbol:r.symbol,
      interval:r.interval,
      side:r.side,
      leverage:r.leverage,
      params:r.params.id,
      finalWeeklyPct:r.finalWeeklyPct,
      allWeeklyPct:r.allWeeklyPct,
      maxDd:r.all.maxDd,
      trades:r.all.trades,
      pf:r.all.pf
    })),
    targetPassCount:pass.length,
    targetPass:pass.slice(0, 10),
    top
  };
  return report;
}

function emitReport(report, quiet=false){
  const text = JSON.stringify(report, null, 2);
  if(process.env.OUTPUT_FILE) writeFileSync(process.env.OUTPUT_FILE, `${text}\n`, 'utf8');
  if(!quiet) console.log(text);
}

async function topSymbols(limit){
  if(process.env.SYMBOLS){
    const rows = process.env.SYMBOLS.split(',').map(x => x.trim()).filter(Boolean);
    return limit > 0 ? rows.slice(0, limit) : rows;
  }
  let info, tickers;
  try{
    [info, tickers] = await Promise.all([
      fetchJson(`${API}/exchangeInfo`),
      fetchJson(`${API}/ticker/24hr`)
    ]);
  }catch(err){
    const fallback = fallbackSymbols();
    if(fallback.length){
      console.error(`[fallback] using ${fallback.length} symbols from previous optimizer output: ${err.message}`);
      return limit > 0 ? fallback.slice(0, limit) : fallback;
    }
    throw err;
  }
  const tradable = new Set(info.symbols
    .filter(s => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING')
    .map(s => s.symbol));
  const rows = tickers
    .filter(t => tradable.has(t.symbol) && Number(t.quoteVolume) > 0)
    .sort((a,b) => Number(b.quoteVolume) - Number(a.quoteVolume))
    .map(t => t.symbol);
  return limit > 0 ? rows.slice(0, limit) : rows;
}

function updateBest(map, symbol, row){
  const current = map.get(symbol);
  if(!current || compareResults(row, current) < 0) map.set(symbol, row);
}

function attachStressResult(row, candles, params, side, leverage, settings, ind){
  const stressed = stressSettings(settings);
  const stress = backtest(candles, params, side, leverage, stressed, 0, candles.length, false, ind);
  row.stress = stress;
  row.stressPass = stress.returnPct > 0 &&
    stress.avgRet > estimatedRoundTripCostPct(stressed) * 1.05 &&
    stress.pf >= Math.max(1.15, settings.minPf - .1) &&
    stress.maxDd <= settings.maxDd * 1.1 &&
    stress.liquidations === 0 &&
    stress.maxLossStreak <= 4;
  row.targetPass = row.targetPass && row.stressPass;
}

function stressSettings(settings){
  return {
    ...settings,
    feePct:settings.feePct * 1.25,
    slipPct:settings.slipPct * 1.8,
    spreadPct:settings.spreadPct * 1.8,
    funding8hPct:settings.funding8hPct * 1.5,
    marginPct:settings.marginPct * .85,
    maxPosition:settings.maxPosition * .85
  };
}

async function klines(symbol, interval, limit){
  const rows = [];
  let endTime = '';
  while(rows.length < limit){
    const pageLimit = Math.min(1500, limit - rows.length);
    const page = await fetchJson(`${API}/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${pageLimit}${endTime ? `&endTime=${endTime}` : ''}`);
    if(!Array.isArray(page) || !page.length) break;
    rows.unshift(...page);
    const oldest = Number(page[0][0]);
    if(!oldest || page.length < pageLimit) break;
    endTime = String(oldest - 1);
    await sleep(Math.max(45, Math.floor(SETTINGS.requestDelayMs / 2)));
  }
  return rows.map(k => ({
    time:Number(k[0]), open:Number(k[1]), high:Number(k[2]), low:Number(k[3]), close:Number(k[4]),
    volume:Number(k[5]), quoteVolume:Number(k[7]), trades:Number(k[8]), takerBuyQuote:Number(k[10])
  })).filter(c => c.time && c.close).sort((a,b) => a.time - b.time);
}

async function fetchJson(url){
  const attempts = Number(process.env.FETCH_RETRIES || 4);
  for(let attempt=1; attempt<=attempts; attempt++){
    const res = await fetch(url, {headers:{'accept':'application/json','user-agent':'Mozilla/5.0 weekly-target-optimizer'}});
    if(res.ok) return res.json();
    const retryAfter = Number(res.headers.get('retry-after') || 0);
    const waitMs = retryAfter ? retryAfter * 1000 : (res.status === 418 || res.status === 429 ? Math.min(120000, attempt * 30000) : 0);
    if(attempt < attempts && waitMs){
      console.error(`[rate-limit] ${res.status} waiting ${Math.round(waitMs / 1000)}s for ${url}`);
      await sleep(waitMs);
      continue;
    }
    const err = new Error(`${res.status} ${url}`);
    err.status = res.status;
    throw err;
  }
}

function isRateLimit(err){
  return err && (err.status === 418 || err.status === 429 || /\b(418|429)\b/.test(err.message || ''));
}

function fallbackSymbols(){
  const files = [
    'weekly_optimizer_latest_maker.json',
    'weekly_optimizer_maker_clean.json',
    'weekly_optimizer_aggressive_output.json',
    'weekly_optimizer_output.json'
  ];
  for(const file of files){
    if(!existsSync(file)) continue;
    try{
      const json = readJsonFile(file);
      if(Array.isArray(json.symbols) && json.symbols.length) return json.symbols;
    }catch{}
  }
  return [];
}

function readJsonFile(file){
  const buf = readFileSync(file);
  const hasUtf16Bom = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
  const hasManyNulls = buf.subarray(0, Math.min(buf.length, 80)).some((byte, i) => i % 2 === 1 && byte === 0);
  const text = buf.toString(hasUtf16Bom || hasManyNulls ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

function indicators(candles, p){
  const closes = candles.map(c => c.close);
  return {
    emaFast:ema(closes, p.fast),
    emaSlow:ema(closes, p.slow),
    rsi:rsi(closes, 14),
    atr:atr(candles, 14),
    vwap:rollingVWAP(candles, p.vwapLen),
    avgQuote:rollingAvg(candles.map(c => c.quoteVolume), 20),
    high:rollingHigh(candles.map(c => c.high), p.breakout),
    low:rollingLow(candles.map(c => c.low), p.breakout)
  };
}

function entry(candles, ind, i, p, side){
  const c = candles[i], prev = candles[i-1];
  if(!c || !prev) return false;
  const atrPct = c.close ? ind.atr[i] / c.close * 100 : 0;
  const pulse = ind.avgQuote[i-1] ? c.quoteVolume / ind.avgQuote[i-1] : 1;
  const buyRatio = c.quoteVolume ? c.takerBuyQuote / c.quoteVolume : .5;
  const trendGap = c.close ? Math.abs(ind.emaFast[i] - ind.emaSlow[i]) / c.close * 100 : 0;
  const vwapDist = c.close ? Math.abs(c.close - ind.vwap[i]) / c.close * 100 : 0;
  const range = Math.max(0, c.high - c.low);
  const bodyRatio = range ? Math.abs(c.close - c.open) / range : 0;
  const topWick = range ? (c.high - Math.max(c.open, c.close)) / range : 0;
  const bottomWick = range ? (Math.min(c.open, c.close) - c.low) / range : 0;
  const longTrend = c.close > ind.emaFast[i] && ind.emaFast[i] > ind.emaSlow[i] && c.close > ind.vwap[i];
  const shortTrend = c.close < ind.emaFast[i] && ind.emaFast[i] < ind.emaSlow[i] && c.close < ind.vwap[i];
  const baseOk = Number.isFinite(atrPct) && Number.isFinite(pulse) && Number.isFinite(ind.rsi[i]) &&
    pulse >= p.pulse && atrPct >= p.minAtr && atrPct <= p.maxAtr &&
    trendGap >= p.minTrend && vwapDist <= p.maxVwapDist && bodyRatio >= p.minBody;
  if(p.mode === 'meanrevert'){
    if(!baseOk || !Number.isFinite(ind.vwap[i])) return false;
    if(side === 'LONG'){
      return c.close < ind.vwap[i] && c.low <= ind.low[i-1] * 1.0004 &&
        bottomWick >= .22 && buyRatio >= p.minLongBuyRatio &&
        ind.rsi[i] >= p.minRsiLong && ind.rsi[i] <= p.maxRsiLong &&
        (c.close > c.open || c.close > prev.close);
    }
    return c.close > ind.vwap[i] && c.high >= ind.high[i-1] * .9996 &&
      topWick >= .22 && buyRatio <= p.maxShortBuyRatio &&
      ind.rsi[i] >= p.minRsiShort && ind.rsi[i] <= p.maxRsiShort &&
      (c.close < c.open || c.close < prev.close);
  }
  if(side === 'LONG'){
    if(!baseOk || !longTrend || buyRatio < p.minLongBuyRatio || c.close <= c.open || topWick > .48 || ind.rsi[i] < p.minRsiLong || ind.rsi[i] > p.maxRsiLong) return false;
    if(p.mode === 'impulse') return pctMove(c, prev) >= .18 && closeNearHigh(c);
    if(p.mode === 'pullback') return prev.low <= ind.emaFast[i-1] * 1.002 && c.close > ind.emaFast[i];
    if(p.mode === 'reclaim') return prev.close < ind.vwap[i-1] && c.close > ind.vwap[i];
    return c.close > ind.high[i-1] * 1.0002;
  }
  if(!baseOk || !shortTrend || buyRatio > p.maxShortBuyRatio || c.close >= c.open || bottomWick > .48 || ind.rsi[i] < p.minRsiShort || ind.rsi[i] > p.maxRsiShort) return false;
  if(p.mode === 'impulse') return pctMove(c, prev) <= -.18 && closeNearLow(c);
  if(p.mode === 'pullback') return prev.high >= ind.emaFast[i-1] * .998 && c.close < ind.emaFast[i];
  if(p.mode === 'reclaim') return prev.close > ind.vwap[i-1] && c.close < ind.vwap[i];
  return c.close < ind.low[i-1] * .9998;
}

function entryDirection(candles, ind, i, p){
  const longHit = entry(candles, ind, i, p, 'LONG');
  const shortHit = entry(candles, ind, i, p, 'SHORT');
  if(longHit && shortHit) return directionBias(candles, ind, i) >= 0 ? 'LONG' : 'SHORT';
  if(longHit) return 'LONG';
  if(shortHit) return 'SHORT';
  return null;
}

function backtest(candles, params, side, leverage, s, rangeStart, rangeEnd, collectTrades, sharedInd){
  let cash = s.capital, peak = cash, maxDd = 0, wins = 0, trades = 0, grossWin = 0, grossLoss = 0;
  let liquidations = 0, sumNetRet = 0, consecutiveLosses = 0, maxLossStreak = 0;
  const ind = sharedInd || indicators(candles, params);
  const warm = Math.max(params.slow + 2, params.vwapLen + 2, params.breakout + 2, 40);
  const start = Math.max(warm, rangeStart);
  const end = Math.min(candles.length - 2, rangeEnd - 1);
  for(let i=start; i<end; i++){
    const activeSide = side === 'BOTH' ? entryDirection(candles, ind, i, params) : (entry(candles, ind, i, params, side) ? side : null);
    if(!activeSide) continue;
    const entryBar = candles[i+1];
    const entryPrice = entryFillPrice(entryBar.open, activeSide, s);
    const margin = Math.min(cash * s.marginPct / 100, s.maxPosition / leverage);
    const order = Math.min(s.maxPosition, margin * leverage);
    if(margin < 5000 || order < 5000) continue;
    const tp = activeSide === 'LONG' ? entryPrice * (1 + params.tp/100) : entryPrice * (1 - params.tp/100);
    const sl = activeSide === 'LONG' ? entryPrice * (1 - params.sl/100) : entryPrice * (1 + params.sl/100);
    const liqAdversePct = liquidationAdversePct(leverage);
    const liqPrice = activeSide === 'LONG' ? entryPrice * (1 - liqAdversePct/100) : entryPrice * (1 + liqAdversePct/100);
    if(Math.max(0, liqAdversePct - params.sl) < s.minLiqBuffer) continue;
    let trailStop = sl, exitPrice = exitFillPrice(candles[Math.min(candles.length - 1, i + 1 + params.maxHold)].close, activeSide, s);
    let exitIdx = Math.min(candles.length - 1, i + 1 + params.maxHold), liquidated = false;
    for(let j=i+1; j<=exitIdx; j++){
      const c = candles[j];
      if(activeSide === 'LONG'){
        const activeStop = Math.max(sl, trailStop);
        if(c.low <= liqPrice){ exitPrice = liqPrice; exitIdx = j; liquidated = true; break; }
        if(c.low <= activeStop){ exitPrice = exitFillPrice(activeStop, activeSide, s, s.stopSlipMult || 1.35); exitIdx = j; break; }
        if(c.high >= tp){ exitPrice = exitFillPrice(tp, activeSide, s); exitIdx = j; break; }
        if(params.trail && c.high > entryPrice * (1 + Math.max(.2, params.trail*.55)/100)) trailStop = Math.max(trailStop, c.high * (1 - params.trail/100));
      }else{
        const activeStop = Math.min(sl, trailStop);
        if(c.high >= liqPrice){ exitPrice = liqPrice; exitIdx = j; liquidated = true; break; }
        if(c.high >= activeStop){ exitPrice = exitFillPrice(activeStop, activeSide, s, s.stopSlipMult || 1.35); exitIdx = j; break; }
        if(c.low <= tp){ exitPrice = exitFillPrice(tp, activeSide, s); exitIdx = j; break; }
        if(params.trail && c.low < entryPrice * (1 - Math.max(.2, params.trail*.55)/100)) trailStop = Math.min(trailStop, c.low * (1 + params.trail/100));
      }
      if(s.mtmDd){
        const adversePrice = activeSide === 'LONG' ? Math.max(liqPrice, c.low) : Math.min(liqPrice, c.high);
        const worstEq = cash + order * (markRetPct(entryPrice, adversePrice, activeSide) - s.feePct) / 100;
        maxDd = Math.max(maxDd, peak ? (peak - worstEq) / peak * 100 : 0);
      }
    }
    const rawRet = markRetPct(entryPrice, exitPrice, activeSide);
    const netRet = rawRet - s.feePct - fundingCostPct(entryBar.time, candles[exitIdx].time, s);
    const pnl = liquidated ? -Math.min(cash, margin * 1.002) : order * netRet / 100;
    cash = Math.max(0, cash + pnl);
    peak = Math.max(peak, cash);
    maxDd = Math.max(maxDd, peak ? (peak - cash) / peak * 100 : 0);
    trades++;
    sumNetRet += netRet;
    if(liquidated) liquidations++;
    if(pnl >= 0){ wins++; grossWin += pnl; consecutiveLosses = 0; }
    else { grossLoss += Math.abs(pnl); consecutiveLosses++; maxLossStreak = Math.max(maxLossStreak, consecutiveLosses); }
    if(cash <= 0) break;
    i = exitIdx + s.cooldown;
  }
  return {
    returnPct:(cash / s.capital - 1) * 100, finalEquity:cash, maxDd, trades, liquidations,
    winRate:trades ? wins / trades * 100 : 0, pf:grossLoss ? grossWin / grossLoss : grossWin ? 99 : 0,
    avgRet:trades ? sumNetRet / trades : 0, maxLossStreak
  };
}

function decorate(symbol, interval, candles, params, side, leverage, train, test, final, all, s){
  const returns = [train.returnPct, test.returnPct, final.returnPct];
  const pfs = [train.pf, test.pf, final.pf];
  const dds = [train.maxDd, test.maxDd, final.maxDd];
  const avgTradeRets = [train.avgRet, test.avgRet, final.avgRet];
  const avgReturn = mean(returns);
  const worstReturn = Math.min(...returns);
  const returnStd = stdev(returns);
  const minSplitPf = Math.min(...pfs);
  const minAvgTradeRet = Math.min(...avgTradeRets);
  const maxSplitDd = Math.max(...dds);
  const costHurdle = estimatedRoundTripCostPct(s) * 1.15;
  const finalDays = Math.max(.01, (candles[candles.length - 1].time - candles[Math.floor(candles.length * .78)].time) / 86400000);
  const finalWeeklyPct = weeklyize(final.returnPct, finalDays);
  const allDays = Math.max(.01, (candles[candles.length - 1].time - candles[0].time) / 86400000);
  const allWeeklyPct = weeklyize(all.returnPct, allDays);
  const score = worstReturn * 2.1 + avgReturn * .3 + finalWeeklyPct * .35 + Math.min(8, Math.max(0, minSplitPf - 1) * 4) -
    maxSplitDd * 1.2 - returnStd * 1.25 - Math.max(0, leverage - 4) * 1.1 -
    Math.max(0, (all.maxLossStreak || 0) - 3) * 5 - Math.max(0, costHurdle - minAvgTradeRet) * 22;
  const validationPass = train.returnPct > 0 && test.returnPct > 0 && train.avgRet > costHurdle && test.avgRet > costHurdle &&
    train.pf >= s.minPf && test.pf >= s.minPf && all.trades >= s.minTrades && train.maxDd <= s.maxDd && test.maxDd <= s.maxDd &&
    (!s.rejectLiq || (train.liquidations === 0 && test.liquidations === 0));
  const finalPass = final.returnPct > 0 && final.avgRet > costHurdle && final.pf >= s.minPf && final.maxDd <= s.maxDd && (!s.rejectLiq || final.liquidations === 0);
  const stabilityPass = worstReturn > 0 &&
    returnStd <= Math.max(4, Math.abs(avgReturn) * 1.4) &&
    maxSplitDd <= s.maxDd &&
    all.maxLossStreak <= 3 &&
    all.liquidations === 0 &&
    all.trades >= s.minTrades;
  const targetPass = validationPass && finalPass && stabilityPass && finalWeeklyPct >= s.targetWeeklyPct && allWeeklyPct >= Math.min(3, s.targetWeeklyPct * .35);
  return {symbol, interval, side, leverage, params, train, test, final, all, finalWeeklyPct, allWeeklyPct, score, validationPass, finalPass, stabilityPass, targetPass, minAvgTradeRet, costHurdle};
}

function compareResults(a,b){
  return Number(b.targetPass) - Number(a.targetPass) ||
    Number(b.validationPass && b.finalPass) - Number(a.validationPass && a.finalPass) ||
    b.score - a.score ||
    b.finalWeeklyPct - a.finalWeeklyPct;
}

function weeklyize(returnPct, days){
  return (Math.pow(Math.max(0.01, 1 + returnPct / 100), 7 / days) - 1) * 100;
}

function directionBias(candles, ind, i){
  const c = candles[i], prev = candles[i-1];
  if(!c || !prev || !c.close) return 0;
  return ((ind.emaFast[i] - ind.emaSlow[i]) / c.close + (c.close - ind.vwap[i]) / c.close + (c.close - c.open) / c.open + (c.close - prev.close) / prev.close) * 100;
}

function ema(values, period){
  const out = Array(values.length).fill(NaN), k = 2 / (period + 1);
  let prev = values[0];
  for(let i=0; i<values.length; i++){ prev = i === 0 ? values[i] : values[i] * k + prev * (1-k); out[i] = prev; }
  return out;
}

function rsi(values, period){
  const out = Array(values.length).fill(50); let gain = 0, loss = 0;
  for(let i=1; i<values.length; i++){
    const d = values[i] - values[i-1];
    if(i <= period){ if(d >= 0) gain += d; else loss -= d; out[i] = 50; continue; }
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = loss ? 100 - 100 / (1 + gain / loss) : 100;
  }
  return out;
}

function atr(candles, period){
  const tr = candles.map((c,i) => i ? Math.max(c.high-c.low, Math.abs(c.high-candles[i-1].close), Math.abs(c.low-candles[i-1].close)) : c.high-c.low);
  return rollingAvg(tr, period);
}

function rollingVWAP(candles, len){
  const out = Array(candles.length).fill(NaN);
  for(let i=0; i<candles.length; i++){
    const start = Math.max(0, i - len + 1);
    let pv = 0, v = 0;
    for(let j=start; j<=i; j++){ const vol = candles[j].volume || 0; pv += ((candles[j].high + candles[j].low + candles[j].close) / 3) * vol; v += vol; }
    out[i] = v ? pv / v : candles[i].close;
  }
  return out;
}

function rollingAvg(values, len){
  const out = Array(values.length).fill(NaN); let sum = 0;
  for(let i=0; i<values.length; i++){ sum += values[i] || 0; if(i >= len) sum -= values[i-len] || 0; out[i] = sum / Math.min(len, i+1); }
  return out;
}

function rollingHigh(values, len){ return values.map((_,i) => Math.max(...values.slice(Math.max(0, i-len+1), i+1))); }
function rollingLow(values, len){ return values.map((_,i) => Math.min(...values.slice(Math.max(0, i-len+1), i+1))); }
function pctMove(c,p){ return p?.close ? (c.close / p.close - 1) * 100 : 0; }
function closeNearHigh(c){ return (c.high - c.close) / Math.max(1e-9, c.high - c.low) <= .25; }
function closeNearLow(c){ return (c.close - c.low) / Math.max(1e-9, c.high - c.low) <= .25; }
function markRetPct(entry, exit, side){ return side === 'LONG' ? (exit / entry - 1) * 100 : (entry / exit - 1) * 100; }
function liquidationAdversePct(leverage){ return Math.max(.05, 100 / Math.max(1, leverage) - .85); }
function estimatedRoundTripCostPct(s){ return Math.max(0, s.feePct) + Math.max(0, s.slipPct) * 2 + Math.max(0, s.spreadPct); }
function executionHalfSpreadPct(s){ return Math.max(0, s.spreadPct) / 2; }
function entryFillPrice(price, side, s){ const cost = (Math.max(0, s.slipPct) + executionHalfSpreadPct(s)) / 100; return side === 'LONG' ? price * (1 + cost) : price * (1 - cost); }
function exitFillPrice(price, side, s, slipMult=1){ const cost = (Math.max(0, s.slipPct) * Math.max(1, slipMult) + executionHalfSpreadPct(s)) / 100; return side === 'LONG' ? price * (1 - cost) : price * (1 + cost); }
function fundingCostPct(entryTime, exitTime, s){ return Math.max(0, (exitTime - entryTime) / 3600000) / 8 * Math.max(0, s.funding8hPct); }
function mean(values){ return values.length ? values.reduce((a,b) => a + b, 0) / values.length : 0; }
function stdev(values){ const m = mean(values); return Math.sqrt(mean(values.map(v => (v - m) ** 2))); }
function round(value){ return Math.round(value * 100) / 100; }
function dedupe(rows){ const seen = new Set(); return rows.filter(r => { const k = JSON.stringify(r); if(seen.has(k)) return false; seen.add(k); return true; }); }
function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
