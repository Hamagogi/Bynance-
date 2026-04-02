import { useEffect, useRef, useCallback } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import { calcMA } from '../indicators/ma';
import { calcEMA } from '../indicators/ema';
import { calcRSI } from '../indicators/rsi';
import { calcMACD } from '../indicators/macd';
import { calcBollingerBands } from '../indicators/bollingerBands';
import { INDICATOR_COLORS } from '../constants';
import './ChartContainer.css';

const CHART_OPTIONS = {
  layout: {
    background: { type: ColorType.Solid, color: '#131722' },
    textColor: '#d1d4dc',
  },
  grid: {
    vertLines: { color: '#1e222d' },
    horzLines: { color: '#1e222d' },
  },
  crosshair: {
    mode: 0,
    vertLine: { color: '#758696', width: 1, style: 3, labelBackgroundColor: '#2962FF' },
    horzLine: { color: '#758696', width: 1, style: 3, labelBackgroundColor: '#2962FF' },
  },
  timeScale: {
    timeVisible: true,
    secondsVisible: false,
    borderColor: '#2B2B43',
  },
  rightPriceScale: {
    borderColor: '#2B2B43',
  },
};

export default function ChartContainer({ data, activeIndicators }) {
  const mainChartRef = useRef(null);
  const rsiChartRef = useRef(null);
  const macdChartRef = useRef(null);

  const mainChart = useRef(null);
  const rsiChart = useRef(null);
  const macdChart = useRef(null);

  const seriesRefs = useRef({});

  const createMainChart = useCallback(() => {
    if (!mainChartRef.current) return;

    if (mainChart.current) {
      mainChart.current.remove();
      mainChart.current = null;
    }
    seriesRefs.current = {};

    const chart = createChart(mainChartRef.current, {
      ...CHART_OPTIONS,
      width: mainChartRef.current.clientWidth,
      height: 450,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderDownColor: '#ef5350',
      borderUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      wickUpColor: '#26a69a',
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    seriesRefs.current.candle = candleSeries;
    seriesRefs.current.volume = volumeSeries;
    mainChart.current = chart;

    return chart;
  }, []);

  const updateMainChart = useCallback(() => {
    if (!data.length || !mainChart.current) return;

    const { candle, volume } = seriesRefs.current;
    if (!candle || !volume) return;

    candle.setData(data);

    const volumeData = data.map((d) => ({
      time: d.time,
      value: d.volume,
      color: d.close >= d.open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)',
    }));
    volume.setData(volumeData);

    // Remove old indicator series
    ['ma7', 'ma25', 'ma99', 'ema', 'bbUpper', 'bbMiddle', 'bbLower'].forEach((key) => {
      if (seriesRefs.current[key]) {
        mainChart.current.removeSeries(seriesRefs.current[key]);
        seriesRefs.current[key] = null;
      }
    });

    // MA
    if (activeIndicators.ma) {
      [
        { period: 7, key: 'ma7', color: INDICATOR_COLORS.ma7 },
        { period: 25, key: 'ma25', color: INDICATOR_COLORS.ma25 },
        { period: 99, key: 'ma99', color: INDICATOR_COLORS.ma99 },
      ].forEach(({ period, key, color }) => {
        const maData = calcMA(data, period);
        if (maData.length) {
          const series = mainChart.current.addLineSeries({
            color,
            lineWidth: 1,
            priceLineVisible: false,
            lastValueVisible: false,
          });
          series.setData(maData);
          seriesRefs.current[key] = series;
        }
      });
    }

    // EMA
    if (activeIndicators.ema) {
      const emaData = calcEMA(data, 20);
      if (emaData.length) {
        const series = mainChart.current.addLineSeries({
          color: INDICATOR_COLORS.ema,
          lineWidth: 1.5,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        series.setData(emaData);
        seriesRefs.current.ema = series;
      }
    }

    // Bollinger Bands
    if (activeIndicators.bb) {
      const bb = calcBollingerBands(data, 20, 2);
      if (bb.upper.length) {
        const upperSeries = mainChart.current.addLineSeries({
          color: INDICATOR_COLORS.bbUpper,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        upperSeries.setData(bb.upper);
        seriesRefs.current.bbUpper = upperSeries;

        const middleSeries = mainChart.current.addLineSeries({
          color: INDICATOR_COLORS.bbMiddle,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        middleSeries.setData(bb.middle);
        seriesRefs.current.bbMiddle = middleSeries;

        const lowerSeries = mainChart.current.addLineSeries({
          color: INDICATOR_COLORS.bbLower,
          lineWidth: 1,
          lineStyle: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        lowerSeries.setData(bb.lower);
        seriesRefs.current.bbLower = lowerSeries;
      }
    }

    mainChart.current.timeScale().fitContent();
  }, [data, activeIndicators]);

  const updateRSIChart = useCallback(() => {
    if (!activeIndicators.rsi) {
      if (rsiChart.current) {
        rsiChart.current.remove();
        rsiChart.current = null;
      }
      return;
    }

    if (!data.length) return;

    if (!rsiChart.current && rsiChartRef.current) {
      rsiChart.current = createChart(rsiChartRef.current, {
        ...CHART_OPTIONS,
        width: rsiChartRef.current.clientWidth,
        height: 150,
      });
    }

    if (!rsiChart.current) return;

    // Remove old series
    if (seriesRefs.current.rsiLine) {
      rsiChart.current.removeSeries(seriesRefs.current.rsiLine);
    }
    if (seriesRefs.current.rsiUpper) {
      rsiChart.current.removeSeries(seriesRefs.current.rsiUpper);
    }
    if (seriesRefs.current.rsiLower) {
      rsiChart.current.removeSeries(seriesRefs.current.rsiLower);
    }

    const rsiData = calcRSI(data, 14);

    const rsiSeries = rsiChart.current.addLineSeries({
      color: INDICATOR_COLORS.rsi,
      lineWidth: 1.5,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    rsiSeries.setData(rsiData);
    seriesRefs.current.rsiLine = rsiSeries;

    // Reference lines at 30 and 70
    const upperLine = rsiChart.current.addLineSeries({
      color: 'rgba(239, 83, 80, 0.4)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    upperLine.setData(rsiData.map((d) => ({ time: d.time, value: 70 })));
    seriesRefs.current.rsiUpper = upperLine;

    const lowerLine = rsiChart.current.addLineSeries({
      color: 'rgba(38, 166, 154, 0.4)',
      lineWidth: 1,
      lineStyle: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    lowerLine.setData(rsiData.map((d) => ({ time: d.time, value: 30 })));
    seriesRefs.current.rsiLower = lowerLine;

    rsiChart.current.timeScale().fitContent();

    // Sync time scale
    if (mainChart.current) {
      mainChart.current.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && rsiChart.current) {
          rsiChart.current.timeScale().setVisibleLogicalRange(range);
        }
      });
    }
  }, [data, activeIndicators.rsi]);

  const updateMACDChart = useCallback(() => {
    if (!activeIndicators.macd) {
      if (macdChart.current) {
        macdChart.current.remove();
        macdChart.current = null;
      }
      return;
    }

    if (!data.length) return;

    if (!macdChart.current && macdChartRef.current) {
      macdChart.current = createChart(macdChartRef.current, {
        ...CHART_OPTIONS,
        width: macdChartRef.current.clientWidth,
        height: 150,
      });
    }

    if (!macdChart.current) return;

    ['macdLineSeries', 'macdSignalSeries', 'macdHistSeries'].forEach((key) => {
      if (seriesRefs.current[key]) {
        macdChart.current.removeSeries(seriesRefs.current[key]);
      }
    });

    const { macdLine, signalLine, histogram } = calcMACD(data);

    const macdLineSeries = macdChart.current.addLineSeries({
      color: INDICATOR_COLORS.macdLine,
      lineWidth: 1.5,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    macdLineSeries.setData(macdLine);
    seriesRefs.current.macdLineSeries = macdLineSeries;

    const macdSignalSeries = macdChart.current.addLineSeries({
      color: INDICATOR_COLORS.macdSignal,
      lineWidth: 1.5,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    macdSignalSeries.setData(signalLine);
    seriesRefs.current.macdSignalSeries = macdSignalSeries;

    const macdHistSeries = macdChart.current.addHistogramSeries({
      priceLineVisible: false,
      lastValueVisible: false,
    });
    macdHistSeries.setData(histogram);
    seriesRefs.current.macdHistSeries = macdHistSeries;

    macdChart.current.timeScale().fitContent();

    if (mainChart.current) {
      mainChart.current.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && macdChart.current) {
          macdChart.current.timeScale().setVisibleLogicalRange(range);
        }
      });
    }
  }, [data, activeIndicators.macd]);

  // Initialize and update main chart
  useEffect(() => {
    createMainChart();
    return () => {
      if (mainChart.current) {
        mainChart.current.remove();
        mainChart.current = null;
      }
    };
  }, [createMainChart]);

  // Update data and indicators
  useEffect(() => {
    if (!mainChart.current) createMainChart();
    updateMainChart();
    updateRSIChart();
    updateMACDChart();
  }, [data, activeIndicators, updateMainChart, updateRSIChart, updateMACDChart, createMainChart]);

  // Resize handler
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (mainChart.current) mainChart.current.applyOptions({ width });
        if (rsiChart.current) rsiChart.current.applyOptions({ width });
        if (macdChart.current) macdChart.current.applyOptions({ width });
      }
    });

    if (mainChartRef.current) observer.observe(mainChartRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="chart-container">
      <div className="chart-main" ref={mainChartRef} />
      {activeIndicators.rsi && (
        <div className="chart-sub">
          <div className="chart-sub-label">RSI (14)</div>
          <div ref={rsiChartRef} />
        </div>
      )}
      {activeIndicators.macd && (
        <div className="chart-sub">
          <div className="chart-sub-label">MACD (12, 26, 9)</div>
          <div ref={macdChartRef} />
        </div>
      )}
    </div>
  );
}
