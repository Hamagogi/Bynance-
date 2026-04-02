export function formatPrice(price) {
  if (price >= 1000) return price.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (price >= 1) return price.toLocaleString('ko-KR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return price.toLocaleString('ko-KR', { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}

export function formatVolume(vol) {
  if (vol >= 1e9) return (vol / 1e9).toFixed(2) + 'B';
  if (vol >= 1e6) return (vol / 1e6).toFixed(2) + 'M';
  if (vol >= 1e3) return (vol / 1e3).toFixed(2) + 'K';
  return vol.toFixed(2);
}

export function formatPercent(pct) {
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}
