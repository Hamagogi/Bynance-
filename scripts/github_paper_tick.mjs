import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const LOCAL_STATE = path.join(ROOT, 'data', 'github_paper_state.json');
const API = process.env.BINANCE_FAPI_BASE || 'https://fapi.binance.com/fapi/v1';

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
  marginPct: 14,
  maxPosition: 900,
  maxPositions: 4,
  minScore: 4.35,
  maxHoldMinutes: 360,
  intervals: ['3m', '5m', '15m'],
  candleLimit: 260
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

  const symbols = readSymbols();
  const market = await loadMarket(symbols, state.settings.intervals, state.settings.candleLimit, state.errors);

  updateOpenPositions(state, market);
  openNewPositions(state, market);
  markEquity(state);

  state.lastUpdated = new Date(now).toISOString();
  state.stats = makeStats(state);
  trimState(state);
  await writeOutputs(state);
}

function readSymbols(){
  return (process.env.PAPER_SYMBOLS || DEFAULT_SYMBOLS.join(','))
    .split(',')
    .map(x => x.trim().toUpperCase())
    .filter(Boolean);
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
    marginPct: number(process.env.PAPER_MARGIN_PCT, previous.marginPct ?? DEFAULT_SETTINGS.marginPct),
    maxPosition: number(process.env.PAPER_MAX_POSITION, previous.maxPosition ?? DEFAULT_SETTINGS.maxPosition),
    maxPositions: Math.floor(number(process.env.PAPER_MAX_POSITIONS, previous.maxPositions ?? DEFAULT_SETTINGS.maxPositions)),
    minScore: number(process.env.PAPER_MIN_SCORE, previous.minScore ?? DEFAULT_SETTINGS.minScore),
    maxHoldMinutes: number(process.env.PAPER_MAX_HOLD_MINUTES, previous.maxHoldMinutes ?? DEFAULT_SETTINGS.maxHoldMinutes),
    candleLimit: Math.floor(number(process.env.PAPER_KLINES, previous.candleLimit ?? DEFAULT_SETTINGS.candleLimit)),
    intervals
  };
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
      jobs.push(fetchKlines(symbol, interval, limit)
        .then(candles => {
          if(!market.has(symbol)) market.set(symbol, new Map());
          market.get(symbol).set(interval, candles);
        })
        .catch(error => errors.push(`[${symbol} ${interval}] ${error.message || String(error)}`)));
    }
  }
  await Promise.all(jobs);
  return market;
}

async function fetchKlines(symbol, interval, limit){
  const url = `${API}/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if(!res.ok) throw new Error(`Binance HTTP ${res.status}`);
  const rows = await res.json();
  if(!Array.isArray(rows) || rows.length < 80) throw new Error('not enough candles');
  return rows.map(r => ({
    time: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5])
  }));
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

    const hitTp = pos.side === 'LONG' ? candle.high >= pos.tp : candle.low <= pos.tp;
    const hitSl = pos.side === 'LONG' ? candle.low <= pos.sl : candle.high >= pos.sl;
    const ageMinutes = (now - (pos.openedAt || now)) / 60000;
    const timedOut = ageMinutes >= settings.maxHoldMinutes;

    if(hitSl || hitTp || timedOut){
      const reason = hitSl ? 'SL' : hitTp ? 'TP' : 'TIME';
      const exit = hitSl ? pos.sl : hitTp ? pos.tp : candle.close;
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
  const openSymbols = new Set(state.positions.map(p => p.symbol));
  const capacity = Math.max(0, settings.maxPositions - state.positions.length);
  if(!capacity) return;

  const candidates = [];
  for(const [symbol, intervals] of market.entries()){
    if(openSymbols.has(symbol)) continue;
    let best = null;
    for(const [interval, candles] of intervals.entries()){
      const signal = scoreSignal(symbol, interval, candles);
      if(signal && (!best || signal.score > best.score)) best = signal;
    }
    if(best && best.score >= settings.minScore) candidates.push(best);
  }

  candidates.sort((a,b) => b.score - a.score);
  for(const signal of candidates.slice(0, capacity)) openPosition(state, signal);
}

function scoreSignal(symbol, interval, candles){
  const c = closedCandles(candles);
  if(c.length < 80) return null;
  const close = c.map(x => x.close);
  const high = c.map(x => x.high);
  const low = c.map(x => x.low);
  const volume = c.map(x => x.volume);
  const last = c.at(-1);
  const prev = c.at(-2);
  const ema20 = ema(close, 20);
  const ema50 = ema(close, 50);
  const r = rsi(close, 14);
  const a = atr(c, 14);
  const avgVol = sma(volume.slice(-30));
  const atrPct = a / last.close * 100;
  if(!Number.isFinite(atrPct) || atrPct < 0.22 || atrPct > 4.8) return null;

  const recentHigh = Math.max(...high.slice(-18, -1));
  const recentLow = Math.min(...low.slice(-18, -1));
  const volPulse = avgVol ? last.volume / avgVol : 1;
  const slope20 = ema20.at(-1) - ema20.at(-6);
  const trendLong = last.close > ema50.at(-1) && ema20.at(-1) > ema50.at(-1);
  const trendShort = last.close < ema50.at(-1) && ema20.at(-1) < ema50.at(-1);

  let longScore = 0;
  if(trendLong) longScore += 1.25;
  if(last.close > ema20.at(-1)) longScore += 0.8;
  if(slope20 > 0) longScore += 0.65;
  if(r >= 45 && r <= 67) longScore += 0.95;
  if(last.low <= ema20.at(-1) * 1.004 && last.close > prev.close) longScore += 0.7;
  if(last.close > recentHigh) longScore += 0.95;
  if(volPulse >= 0.9) longScore += Math.min(0.7, (volPulse - 0.9) * 0.55 + 0.25);
  if(atrPct >= 0.35 && atrPct <= 2.9) longScore += 0.45;

  let shortScore = 0;
  if(trendShort) shortScore += 1.25;
  if(last.close < ema20.at(-1)) shortScore += 0.8;
  if(slope20 < 0) shortScore += 0.65;
  if(r >= 33 && r <= 55) shortScore += 0.95;
  if(last.high >= ema20.at(-1) * 0.996 && last.close < prev.close) shortScore += 0.7;
  if(last.close < recentLow) shortScore += 0.95;
  if(volPulse >= 0.9) shortScore += Math.min(0.7, (volPulse - 0.9) * 0.55 + 0.25);
  if(atrPct >= 0.35 && atrPct <= 2.9) shortScore += 0.45;

  const side = longScore >= shortScore ? 'LONG' : 'SHORT';
  const score = Math.max(longScore, shortScore);
  const entry = last.close;
  const stopDistance = Math.max(a * 1.15, entry * 0.0045);
  const takeDistance = Math.max(a * 1.85, entry * 0.0075);
  return {
    symbol,
    interval,
    side,
    score,
    entry,
    mark: entry,
    atr: a,
    atrPct,
    tp: side === 'LONG' ? entry + takeDistance : entry - takeDistance,
    sl: side === 'LONG' ? entry - stopDistance : entry + stopDistance,
    reason: `${interval} score ${score.toFixed(2)} rsi ${r.toFixed(1)} atr ${atrPct.toFixed(2)}%`
  };
}

function openPosition(state, signal){
  const settings = state.settings;
  const equity = equityNow(state);
  const order = Math.min(settings.maxPosition, equity * settings.marginPct / 100 * settings.leverage);
  if(order < 10) return;
  const margin = order / settings.leverage;
  const pos = {
    id: `${signal.symbol}-${signal.interval}-${now}`,
    symbol: signal.symbol,
    interval: signal.interval,
    side: signal.side,
    leverage: settings.leverage,
    entry: signal.entry,
    mark: signal.entry,
    margin,
    order,
    tp: signal.tp,
    sl: signal.sl,
    openedAt: now,
    score: signal.score,
    strategy: 'Actions auto-scan',
    reason: signal.reason
  };
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
  const ret = markRetPct(pos.entry, price, pos.side) - state.settings.feePct;
  const pnl = pos.order * ret / 100;
  state.cash = Math.max(0, state.cash + pnl);
  state.journal.unshift({
    time: now,
    symbol: pos.symbol,
    side: pos.side,
    action: 'CLOSE',
    price,
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
    return sum + pos.order * ret / 100;
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

function sma(values){
  if(!values.length) return 0;
  return values.reduce((s,x) => s + x, 0) / values.length;
}

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
