import Link from 'next/link';
import NavBar from '@/components/NavBar';
import { PLANS } from '@/lib/plans';

export default function LandingPage() {
  return (
    <>
      <NavBar />

      <main>
        <section className="mx-auto max-w-5xl px-4 py-20 text-center">
          <p className="mb-3 inline-block rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
            AI content repurposing
          </p>
          <h1 className="mb-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
            One idea → five platforms.
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-gray-600">
            Paste a YouTube video, blog URL, or your own draft. ContentShift rewrites
            it natively for Instagram, X, LinkedIn, YouTube Shorts, and your
            newsletter – in seconds.
          </p>
          <div className="flex justify-center gap-3">
            <Link href="/signup" className="btn-primary">
              Start free
            </Link>
            <Link href="#pricing" className="btn-ghost">
              See pricing
            </Link>
          </div>
        </section>

        <section className="bg-white py-16">
          <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 px-4 md:grid-cols-3">
            {[
              {
                title: 'Built for creators',
                body: 'Turn one flagship piece into a full week of platform-native posts.'
              },
              {
                title: 'Native tone per channel',
                body: 'Threads sound like threads. LinkedIn sounds like LinkedIn. No copy-paste feel.'
              },
              {
                title: 'Keeps your ideas intact',
                body: 'We rewrite, we don’t invent. Your examples and data stay yours.'
              }
            ].map((f) => (
              <div key={f.title} className="card">
                <h3 className="mb-1 font-semibold">{f.title}</h3>
                <p className="text-sm text-gray-600">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-5xl px-4 py-20">
          <h2 className="mb-2 text-center text-3xl font-bold">Simple pricing</h2>
          <p className="mb-10 text-center text-sm text-gray-500">
            Start free. Upgrade when you need more volume.
          </p>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {['free', 'pro', 'agency'].map((id) => {
              const p = PLANS[id];
              return (
                <div key={id} className="card flex flex-col">
                  <h3 className="text-lg font-semibold">{p.name}</h3>
                  <p className="my-2 text-3xl font-bold">
                    ${p.priceUsd}
                    <span className="text-base font-normal text-gray-500">/mo</span>
                  </p>
                  <ul className="mb-6 flex-1 space-y-1 text-sm text-gray-600">
                    {p.features.map((f) => (
                      <li key={f}>• {f}</li>
                    ))}
                  </ul>
                  <Link
                    href={id === 'free' ? '/signup' : '/billing'}
                    className={id === 'pro' ? 'btn-primary' : 'btn-ghost'}
                  >
                    {id === 'free' ? 'Start free' : `Choose ${p.name}`}
                  </Link>
                </div>
              );
            })}
          </div>
        </section>

        <footer className="border-t border-gray-200 py-8 text-center text-sm text-gray-500">
          © {new Date().getFullYear()} ContentShift
        </footer>
      </main>
    </>
  );
}
