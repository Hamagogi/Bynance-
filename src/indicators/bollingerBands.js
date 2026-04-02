export function calcBollingerBands(data, period = 20, stdDevMultiplier = 2) {
  const upper = [];
  const middle = [];
  const lower = [];

  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j].close;
    }
    const mean = sum / period;

    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sqSum += (data[j].close - mean) ** 2;
    }
    const stdDev = Math.sqrt(sqSum / period);

    const time = data[i].time;
    middle.push({ time, value: mean });
    upper.push({ time, value: mean + stdDevMultiplier * stdDev });
    lower.push({ time, value: mean - stdDevMultiplier * stdDev });
  }

  return { upper, middle, lower };
}
