import Stripe from 'stripe';

let stripe;
export function getStripe() {
  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-09-30.acacia'
    });
  }
  return stripe;
}

export const STRIPE_PRICE_IDS = {
  pro: process.env.STRIPE_PRICE_PRO,
  agency: process.env.STRIPE_PRICE_AGENCY
};

export function planIdForPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === STRIPE_PRICE_IDS.pro) return 'pro';
  if (priceId === STRIPE_PRICE_IDS.agency) return 'agency';
  return null;
}
