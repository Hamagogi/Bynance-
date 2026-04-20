import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export default async function NavBar() {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return (
    <header className="border-b border-gray-200 bg-white/70 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold">
          ContentShift
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/#pricing" className="btn-ghost text-sm">
            Pricing
          </Link>
          {user ? (
            <>
              <Link href="/dashboard" className="btn-ghost text-sm">
                Dashboard
              </Link>
              <Link href="/history" className="btn-ghost text-sm">
                History
              </Link>
              <Link href="/billing" className="btn-ghost text-sm">
                Billing
              </Link>
              <form action="/auth/signout" method="post">
                <button className="btn-ghost text-sm" type="submit">
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost text-sm">
                Log in
              </Link>
              <Link href="/signup" className="btn-primary text-sm">
                Get started
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
