import { calcEMA } from './ema.js';
import { calcEMAFromValues } from './ema.js';

export function calcMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEMA = calcEMA(data, fastPeriod);
  const slowEMA = calcEMA(data, slowPeriod);

  if (slowEMA.length === 0) return { macdLine: [], signalLine: [], histogram: [] };

  const slowStart = slowEMA[0].time;
  const fastFiltered = fastEMA.filter((d) => d.time >= slowStart);

  const macdLine = [];
  for (let i = 0; i < slowEMA.length; i++) {
    macdLine.push({
      time: slowEMA[i].time,
      value: fastFiltered[i].value - slowEMA[i].value,
    });
  }

  const signalLine = calcEMAFromValues(macdLine, signalPeriod);

  const signalStart = signalLine.length > 0 ? signalLine[0].time : Infinity;
  const macdFiltered = macdLine.filter((d) => d.time >= signalStart);

  const histogram = [];
  for (let i = 0; i < signalLine.length; i++) {
    const val = macdFiltered[i].value - signalLine[i].value;
    histogram.push({
      time: signalLine[i].time,
      value: val,
      color: val >= 0 ? '#26a69a' : '#ef5350',
    });
  }

  return { macdLine, signalLine, histogram };
}
