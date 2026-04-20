import { getPlan } from '@/lib/plans';

export async function getUserWithPlan(supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, profile: null, plan: getPlan('free') };

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();

  return { user, profile, plan: getPlan(profile?.plan_id || 'free') };
}

export function isOverQuota(profile, plan) {
  if (!profile) return true;
  const now = new Date();
  const start = profile.usage_period_start ? new Date(profile.usage_period_start) : null;
  const sameMonth =
    start &&
    start.getUTCFullYear() === now.getUTCFullYear() &&
    start.getUTCMonth() === now.getUTCMonth();
  const used = sameMonth ? profile.monthly_usage || 0 : 0;
  return used >= plan.monthlyQuota;
}

export async function incrementUsage(supabase, userId) {
  const { data: profile } = await supabase
    .from('users')
    .select('monthly_usage, usage_period_start')
    .eq('id', userId)
    .single();

  const now = new Date();
  const start = profile?.usage_period_start ? new Date(profile.usage_period_start) : null;
  const sameMonth =
    start &&
    start.getUTCFullYear() === now.getUTCFullYear() &&
    start.getUTCMonth() === now.getUTCMonth();

  const next = sameMonth ? (profile?.monthly_usage || 0) + 1 : 1;
  const period = sameMonth
    ? profile.usage_period_start
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

  await supabase
    .from('users')
    .update({ monthly_usage: next, usage_period_start: period, updated_at: now.toISOString() })
    .eq('id', userId);
}
