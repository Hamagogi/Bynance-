# CLAUDE.md

Project notes for Claude Code / future contributors.

## Product

**ContentShift** – paste one piece of content (YouTube URL, article URL, or
raw text) and receive five platform-native outputs:

1. Instagram caption + hashtags
2. X/Twitter thread (5–7 tweets)
3. LinkedIn post
4. YouTube Shorts script (hook + script + CTA)
5. Newsletter summary (subject + body)

## Stack

- Next.js 14 (App Router, JavaScript)
- Tailwind CSS
- Supabase (Auth + Postgres, RLS enabled)
- Anthropic Claude API (`@anthropic-ai/sdk`), model from `ANTHROPIC_MODEL`
- Stripe monthly subscriptions (Free / Pro $29 / Agency $79)
- Deployed on Vercel

## Directory map

```
app/                         # Next.js routes (App Router)
  api/convert/               # POST: run a repurposing job
  api/stripe/checkout/       # POST: create Stripe Checkout session
  api/stripe/portal/         # POST: open billing portal
  api/stripe/webhook/        # POST: Stripe webhook listener
  auth/callback/             # Supabase email confirmation
  auth/signout/              # POST logout
  dashboard/                 # Main app (convert form)
  history/                   # List of past conversions
  history/[id]/              # Single conversion detail
  billing/                   # Plan selection + portal
  login/ signup/             # Auth
  page.js                    # Landing + pricing
components/                  # Shared React components
lib/                         # Server/client utilities
  supabase/                  # Supabase clients (browser/server/middleware)
  extractors/                # YouTube transcript, webpage scraper
  claude.js                  # Claude API wrapper + prompts
  stripe.js                  # Stripe wrapper
  plans.js                   # Plan catalog (mirrors plans table)
  usage.js                   # Quota read/increment helpers
  rateLimit.js               # In-memory per-IP rate limit
  apiGuard.js                # `withPlanGuard()` for API routes
supabase/schema.sql          # Full DB schema + RLS + triggers
middleware.js                # Session refresh + protected routes
```

## Setup

1. Copy `.env.example` → `.env.local` and fill in values.
2. In Supabase dashboard, open SQL editor and run `supabase/schema.sql`.
3. In Stripe dashboard, create two recurring monthly products (Pro $29,
   Agency $79) and paste their price IDs into env vars.
4. `npm install && npm run dev`.
5. Stripe webhook locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`,
   copy the resulting `whsec_…` into `STRIPE_WEBHOOK_SECRET`.

## Environment variables

See `.env.example`. Required:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_AGENCY`
- `NEXT_PUBLIC_SITE_URL`

## Key conventions

- All API routes use `withPlanGuard` from `lib/apiGuard.js` when they need
  auth + quota + rate limiting. The Stripe webhook route is intentionally
  unguarded – it validates Stripe signatures instead.
- Row-level security is on. Every table policy scopes by `auth.uid()`.
- Plan enforcement is handled server-side; the client UI is informational.
- Claude is prompted to return **strict JSON** matching `OUTPUT_SCHEMA` in
  `lib/claude.js`. Never trust client-side output shape.

## Commands

```
npm run dev      # local dev
npm run build    # production build
npm run lint     # eslint
```

## Known TODOs

- Replace `lib/rateLimit.js` in-memory store with Upstash Redis on Vercel.
- Team seats for Agency plan.
- Export (PDF / Notion) button on conversion detail page.
