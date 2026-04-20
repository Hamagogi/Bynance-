export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    priceUsd: 0,
    monthlyQuota: 5,
    features: ['5 conversions / month', 'All 5 output formats', 'Basic history']
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceUsd: 29,
    monthlyQuota: 100,
    features: ['100 conversions / month', 'Priority queue', 'Full history', 'Export']
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    priceUsd: 79,
    monthlyQuota: 500,
    features: ['500 conversions / month', 'Team seats (coming soon)', 'Priority support']
  }
};

export function getPlan(id) {
  return PLANS[id] || PLANS.free;
}
