const BASE_URL = 'https://api.binance.com/api/v3';

export async function fetchKlines(symbol, interval, limit = 500) {
  const res = await fetch(
    `${BASE_URL}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  );
  if (!res.ok) throw new Error(`Klines fetch failed: ${res.status}`);
  const data = await res.json();
  return data.map((d) => ({
    time: Math.floor(d[0] / 1000),
    open: parseFloat(d[1]),
    high: parseFloat(d[2]),
    low: parseFloat(d[3]),
    close: parseFloat(d[4]),
    volume: parseFloat(d[5]),
  }));
}

export async function fetchTicker24hr(symbol) {
  const res = await fetch(`${BASE_URL}/ticker/24hr?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Ticker fetch failed: ${res.status}`);
  const data = await res.json();
  return {
    lastPrice: parseFloat(data.lastPrice),
    priceChangePercent: parseFloat(data.priceChangePercent),
    volume: parseFloat(data.volume),
    quoteVolume: parseFloat(data.quoteVolume),
    highPrice: parseFloat(data.highPrice),
    lowPrice: parseFloat(data.lowPrice),
    weightedAvgPrice: parseFloat(data.weightedAvgPrice),
  };
}
