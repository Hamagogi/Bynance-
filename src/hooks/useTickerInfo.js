import { useState, useEffect, useRef } from 'react';
import { fetchTicker24hr } from '../api/binance';

export function useTickerInfo(symbol) {
  const [ticker, setTicker] = useState(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const data = await fetchTicker24hr(symbol);
        if (!cancelled) {
          setTicker(data);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    intervalRef.current = setInterval(async () => {
      try {
        const data = await fetchTicker24hr(symbol);
        if (!cancelled) setTicker(data);
      } catch {
        // silent
      }
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(intervalRef.current);
    };
  }, [symbol]);

  return { ticker, loading };
}
