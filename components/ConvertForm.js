'use client';

import { useState } from 'react';
import ResultCards from './ResultCards';

export default function ConvertForm({ quota }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setResult(null);
    if (!input.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="card space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">
            Paste a YouTube URL, article URL, or your own text
          </label>
          <textarea
            rows={6}
            className="input"
            placeholder="https://www.youtube.com/watch?v=… or https://example.com/post or raw text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
          />
        </div>
        <div className="flex items-center justify-between">
          {quota ? (
            <p className="text-xs text-gray-500">
              {quota.used} / {quota.total} used this month ({quota.plan} plan)
            </p>
          ) : (
            <span />
          )}
          <button className="btn-primary" disabled={loading}>
            {loading ? 'Transforming…' : 'Repurpose'}
          </button>
        </div>
        {error && (
          <p className="rounded-md bg-red-50 p-2 text-sm text-red-600">{error}</p>
        )}
      </form>

      {loading && (
        <div className="card flex items-center gap-3">
          <div className="h-3 w-3 animate-ping rounded-full bg-brand-500" />
          <p className="text-sm text-gray-600">
            Extracting, summarizing, and formatting five platforms…
          </p>
        </div>
      )}

      {result?.outputs && (
        <>
          <h2 className="text-xl font-semibold">Results</h2>
          <ResultCards outputs={result.outputs} />
        </>
      )}
    </div>
  );
}
