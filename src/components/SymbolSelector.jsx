import { SYMBOLS } from '../constants';
import './SymbolSelector.css';

export default function SymbolSelector({ symbol, onChange }) {
  return (
    <div className="symbol-selector">
      <select value={symbol} onChange={(e) => onChange(e.target.value)}>
        {SYMBOLS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
