# ContentShift

AI content repurposing SaaS – paste one YouTube video, blog URL, or text and
get five platform-native versions instantly.

- Instagram caption + hashtags
- X/Twitter thread (5–7 tweets)
- LinkedIn post
- YouTube Shorts script
- Newsletter summary

## Stack

Next.js 14 · Tailwind · Supabase · Anthropic Claude · Stripe · Vercel

## Quick start

```bash
cp .env.example .env.local
# fill in Supabase + Anthropic + Stripe keys
npm install
npm run dev
```

Then run `supabase/schema.sql` in the Supabase SQL editor.

See [`CLAUDE.md`](./CLAUDE.md) for architecture notes and environment variables.
