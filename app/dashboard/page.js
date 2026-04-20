import { redirect } from 'next/navigation';
import NavBar from '@/components/NavBar';
import ConvertForm from '@/components/ConvertForm';
import { createClient } from '@/lib/supabase/server';
import { getUserWithPlan } from '@/lib/usage';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = createClient();
  const { user, profile, plan } = await getUserWithPlan(supabase);
  if (!user) redirect('/login?next=/dashboard');

  const now = new Date();
  const start = profile?.usage_period_start ? new Date(profile.usage_period_start) : null;
  const sameMonth =
    start &&
    start.getUTCFullYear() === now.getUTCFullYear() &&
    start.getUTCMonth() === now.getUTCMonth();
  const used = sameMonth ? profile?.monthly_usage || 0 : 0;

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-1 text-2xl font-bold">Dashboard</h1>
        <p className="mb-6 text-sm text-gray-500">
          Paste content, get five platform-ready posts.
        </p>
        <ConvertForm quota={{ used, total: plan.monthlyQuota, plan: plan.name }} />
      </main>
    </>
  );
}
