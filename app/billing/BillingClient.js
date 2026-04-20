'use client';

import { useState } from 'react';
import { PLANS } from '@/lib/plans';

export default function BillingClient({ currentPlan, hasSubscription }) {
  const [loading, setLoading] = useState(null);
  const [error, setError] = useState('');

  async function upgrade(plan) {
    setLoading(plan);
    setError('');
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout failed.');
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
      setLoading(null);
    }
  }

  async function openPortal() {
    setLoading('portal');
    setError('');
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Portal failed.');
      window.location.href = data.url;
    } catch (err) {
      setError(err.message);
      setLoading(null);
    }
  }

  const tiers = ['free', 'pro', 'agency'];

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-md bg-red-50 p-2 text-sm text-red-600">{error}</p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {tiers.map((id) => {
          const p = PLANS[id];
          const isCurrent = currentPlan === id;
          return (
            <div key={id} className={`card ${isCurrent ? 'border-brand-500' : ''}`}>
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <p className="my-2 text-2xl font-bold">
                ${p.priceUsd}
                <span className="text-sm font-normal text-gray-500">/mo</span>
              </p>
              <ul className="mb-4 space-y-1 text-sm text-gray-600">
                {p.features.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>
              {id === 'free' ? (
                <button className="btn-ghost w-full" disabled>
                  {isCurrent ? 'Current plan' : 'Downgrade via portal'}
                </button>
              ) : isCurrent ? (
                <button className="btn-ghost w-full" disabled>
                  Current plan
                </button>
              ) : (
                <button
                  className="btn-primary w-full"
                  onClick={() => upgrade(id)}
                  disabled={loading === id}
                >
                  {loading === id ? 'Redirecting…' : `Upgrade to ${p.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {hasSubscription && (
        <button
          className="btn-ghost"
          onClick={openPortal}
          disabled={loading === 'portal'}
        >
          {loading === 'portal' ? 'Opening…' : 'Manage subscription'}
        </button>
      )}
    </div>
  );
}
