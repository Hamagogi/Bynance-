import { redirect } from 'next/navigation';
import NavBar from '@/components/NavBar';
import BillingClient from './BillingClient';
import { createClient } from '@/lib/supabase/server';
import { getUserWithPlan } from '@/lib/usage';

export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const supabase = createClient();
  const { user, profile, plan } = await getUserWithPlan(supabase);
  if (!user) redirect('/login?next=/billing');

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-2 text-2xl font-bold">Billing</h1>
        <p className="mb-6 text-sm text-gray-500">
          Current plan: <span className="font-medium">{plan.name}</span>
          {profile?.subscription_status ? ` (${profile.subscription_status})` : null}
        </p>
        <BillingClient
          currentPlan={plan.id}
          hasSubscription={Boolean(profile?.stripe_subscription_id)}
        />
      </main>
    </>
  );
}
