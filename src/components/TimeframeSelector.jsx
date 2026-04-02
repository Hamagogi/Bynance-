import { TIMEFRAMES } from '../constants';
import './TimeframeSelector.css';

export default function TimeframeSelector({ interval, onChange }) {
  return (
    <div className="timeframe-selector">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.value}
          className={interval === tf.value ? 'active' : ''}
          onClick={() => onChange(tf.value)}
        >
          {tf.label}
        </button>
      ))}
    </div>
  );
}
