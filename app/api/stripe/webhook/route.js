import { NextResponse } from 'next/server';
import { getStripe, planIdForPriceId } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST(req) {
  const stripe = getStripe();
  const signature = req.headers.get('stripe-signature');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: 'Missing signature/secret.' }, { status: 400 });
  }

  const rawBody = await req.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.supabase_user_id;
        if (userId && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          await applySubscription(admin, userId, sub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const userId = await resolveUserId(admin, sub.customer);
        if (userId) await applySubscription(admin, userId, sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const userId = await resolveUserId(admin, sub.customer);
        if (userId) {
          await admin
            .from('users')
            .update({
              plan_id: 'free',
              stripe_subscription_id: null,
              subscription_status: 'canceled',
              current_period_end: null,
              updated_at: new Date().toISOString()
            })
            .eq('id', userId);
        }
        break;
      }
      default:
        break;
    }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function resolveUserId(admin, customerId) {
  if (!customerId) return null;
  const { data } = await admin
    .from('users')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return data?.id || null;
}

async function applySubscription(admin, userId, sub) {
  const priceId = sub.items?.data?.[0]?.price?.id;
  const planId = planIdForPriceId(priceId) || 'free';
  await admin
    .from('users')
    .update({
      plan_id: planId,
      stripe_subscription_id: sub.id,
      stripe_customer_id: sub.customer,
      subscription_status: sub.status,
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId);
}
