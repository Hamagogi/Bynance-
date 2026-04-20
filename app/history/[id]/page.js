import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import NavBar from '@/components/NavBar';
import ResultCards from '@/components/ResultCards';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function HistoryDetailPage({ params }) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: row } = await supabase
    .from('conversions')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!row) notFound();

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Link href="/history" className="text-sm text-brand-600 hover:underline">
          ← Back to history
        </Link>
        <h1 className="mb-1 mt-2 text-2xl font-bold">
          {row.source_title || 'Conversion'}
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          {row.source_type} · {new Date(row.created_at).toLocaleString()}
        </p>

        {row.status === 'error' && (
          <div className="card mb-6 text-sm text-red-600">
            This conversion failed: {row.error_message || 'Unknown error.'}
          </div>
        )}

        {row.outputs ? (
          <ResultCards outputs={row.outputs} />
        ) : (
          <div className="card text-sm text-gray-500">No outputs yet.</div>
        )}
      </main>
    </>
  );
}
