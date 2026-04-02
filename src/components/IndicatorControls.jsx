import './IndicatorControls.css';

const INDICATORS = [
  { key: 'ma', label: 'MA', description: '이동평균선' },
  { key: 'ema', label: 'EMA', description: '지수이동평균' },
  { key: 'bb', label: 'BB', description: '볼린저밴드' },
  { key: 'rsi', label: 'RSI', description: '상대강도지수' },
  { key: 'macd', label: 'MACD', description: 'MACD' },
];

export default function IndicatorControls({ activeIndicators, onToggle }) {
  return (
    <div className="indicator-controls">
      <span className="indicator-label">지표:</span>
      {INDICATORS.map((ind) => (
        <button
          key={ind.key}
          className={activeIndicators[ind.key] ? 'active' : ''}
          onClick={() => onToggle(ind.key)}
          title={ind.description}
        >
          {ind.label}
        </button>
      ))}
    </div>
  );
}
