import { useState, useCallback } from 'react';
import Header from './components/Header';
import IndicatorControls from './components/IndicatorControls';
import ChartContainer from './components/ChartContainer';
import { useKlines } from './hooks/useKlines';
import { useTickerInfo } from './hooks/useTickerInfo';
import './App.css';

export default function App() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('1h');
  const [activeIndicators, setActiveIndicators] = useState({
    ma: true,
    ema: false,
    bb: false,
    rsi: false,
    macd: false,
  });

  const { data, loading, error } = useKlines(symbol, interval);
  const { ticker } = useTickerInfo(symbol);

  const handleToggleIndicator = useCallback((key) => {
    setActiveIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return (
    <div className="app">
      <Header
        symbol={symbol}
        interval={interval}
        ticker={ticker}
        onSymbolChange={setSymbol}
        onIntervalChange={setInterval}
      />
      <div className="app-body">
        <IndicatorControls
          activeIndicators={activeIndicators}
          onToggle={handleToggleIndicator}
        />
        {error && <div className="error-msg">오류: {error}</div>}
        {loading && !data.length ? (
          <div className="loading-msg">차트 데이터 로딩중...</div>
        ) : (
          <ChartContainer data={data} activeIndicators={activeIndicators} />
        )}
      </div>
    </div>
  );
}
