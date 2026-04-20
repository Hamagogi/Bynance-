import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getUserWithPlan, isOverQuota } from '@/lib/usage';
import { rateLimit, getClientIp } from '@/lib/rateLimit';

// Wrap any /api handler that needs auth + plan + rate limit.
// Usage:
//   export const POST = withPlanGuard(async ({ req, user, profile, plan, supabase }) => { ... });
export function withPlanGuard(handler, opts = {}) {
  const { max = 20, windowMs = 60_000, requirePaid = false } = opts;
  return async function guarded(req) {
    const ip = getClientIp(req);
    const rl = rateLimit(`api:${ip}`, { max, windowMs });
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again soon.' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } }
      );
    }

    const supabase = createClient();
    const { user, profile, plan } = await getUserWithPlan(supabase);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (requirePaid && plan.id === 'free') {
      return NextResponse.json(
        { error: 'This feature requires a paid plan.' },
        { status: 402 }
      );
    }
    if (isOverQuota(profile, plan)) {
      return NextResponse.json(
        { error: `You have reached your ${plan.name} plan quota.` },
        { status: 402 }
      );
    }
    return handler({ req, user, profile, plan, supabase });
  };
}
