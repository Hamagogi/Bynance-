import { formatPrice, formatVolume, formatPercent } from '../utils/formatters';
import './MarketInfo.css';

export default function MarketInfo({ ticker, symbol }) {
  if (!ticker) return <div className="market-info loading">로딩중...</div>;

  const isPositive = ticker.priceChangePercent >= 0;

  return (
    <div className="market-info">
      <div className="market-info-price">
        <span className={`price ${isPositive ? 'up' : 'down'}`}>
          {formatPrice(ticker.lastPrice)}
        </span>
        <span className={`change ${isPositive ? 'up' : 'down'}`}>
          {formatPercent(ticker.priceChangePercent)}
        </span>
      </div>
      <div className="market-info-details">
        <div className="detail">
          <span className="label">24시간 거래량</span>
          <span className="value">{formatVolume(ticker.quoteVolume)} USDT</span>
        </div>
        <div className="detail">
          <span className="label">최고가</span>
          <span className="value">{formatPrice(ticker.highPrice)}</span>
        </div>
        <div className="detail">
          <span className="label">최저가</span>
          <span className="value">{formatPrice(ticker.lowPrice)}</span>
        </div>
      </div>
    </div>
  );
}
