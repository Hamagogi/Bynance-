import SymbolSelector from './SymbolSelector';
import TimeframeSelector from './TimeframeSelector';
import MarketInfo from './MarketInfo';
import './Header.css';

export default function Header({ symbol, interval, ticker, onSymbolChange, onIntervalChange }) {
  return (
    <header className="header">
      <div className="header-left">
        <h1 className="logo">Bynance</h1>
        <SymbolSelector symbol={symbol} onChange={onSymbolChange} />
        <TimeframeSelector interval={interval} onChange={onIntervalChange} />
      </div>
      <div className="header-right">
        <MarketInfo ticker={ticker} symbol={symbol} />
      </div>
    </header>
  );
}
