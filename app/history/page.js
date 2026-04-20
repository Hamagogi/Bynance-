import Link from 'next/link';
import { redirect } from 'next/navigation';
import NavBar from '@/components/NavBar';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/history');

  const { data: rows } = await supabase
    .from('conversions')
    .select('id, source_type, source_title, source_input, status, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <>
      <NavBar />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold">History</h1>
        {!rows?.length ? (
          <div className="card text-sm text-gray-500">
            No conversions yet.{' '}
            <Link className="text-brand-600 hover:underline" href="/dashboard">
              Create your first
            </Link>
            .
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/history/${r.id}`}
                  className="card flex items-center justify-between hover:border-brand-500"
                >
                  <div>
                    <p className="line-clamp-1 font-medium">
                      {r.source_title || r.source_input.slice(0, 80)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {r.source_type} · {new Date(r.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      r.status === 'done'
                        ? 'bg-green-100 text-green-700'
                        : r.status === 'error'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {r.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
