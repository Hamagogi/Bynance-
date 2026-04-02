import { useState, useEffect, useRef } from 'react';
import { fetchKlines } from '../api/binance';

export function useKlines(symbol, interval) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const intervalRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const klines = await fetchKlines(symbol, interval);
        if (!cancelled) {
          setData(klines);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }

    load();

    intervalRef.current = setInterval(async () => {
      try {
        const klines = await fetchKlines(symbol, interval);
        if (!cancelled) setData(klines);
      } catch {
        // silent retry on polling
      }
    }, 10000);

    return () => {
      cancelled = true;
      clearInterval(intervalRef.current);
    };
  }, [symbol, interval]);

  return { data, loading, error };
}
