export function calcEMA(data, period) {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].close;
  }
  let ema = sum / period;
  result.push({ time: data[period - 1].time, value: ema });

  for (let i = period; i < data.length; i++) {
    ema = data[i].close * k + ema * (1 - k);
    result.push({ time: data[i].time, value: ema });
  }
  return result;
}

export function calcEMAFromValues(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const result = [];

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i].value;
  }
  let ema = sum / period;
  result.push({ time: values[period - 1].time, value: ema });

  for (let i = period; i < values.length; i++) {
    ema = values[i].value * k + ema * (1 - k);
    result.push({ time: values[i].time, value: ema });
  }
  return result;
}
