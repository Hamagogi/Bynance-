-- ContentShift database schema
-- Run in Supabase SQL editor.

create extension if not exists "pgcrypto";

-- =========================================================
-- plans: subscription tiers
-- =========================================================
create table if not exists public.plans (
  id                text primary key,          -- 'free' | 'pro' | 'agency'
  name              text not null,
  price_cents       integer not null default 0,
  monthly_quota     integer not null default 5,
  stripe_price_id   text,
  features          jsonb not null default '[]'::jsonb
);

insert into public.plans (id, name, price_cents, monthly_quota, features)
values
  ('free',   'Free',   0,    5,  '["5 conversions / month","All 5 output formats"]'),
  ('pro',    'Pro',    2900, 100,'["100 conversions / month","Priority queue","Full history"]'),
  ('agency', 'Agency', 7900, 500,'["500 conversions / month","Team seats (coming)","Priority support"]')
on conflict (id) do update
set name = excluded.name,
    price_cents = excluded.price_cents,
    monthly_quota = excluded.monthly_quota,
    features = excluded.features;

-- =========================================================
-- users: profile + subscription state (PK = auth.users.id)
-- =========================================================
create table if not exists public.users (
  id                       uuid primary key references auth.users(id) on delete cascade,
  email                    text,
  plan_id                  text not null default 'free' references public.plans(id),
  stripe_customer_id       text,
  stripe_subscription_id   text,
  subscription_status      text,
  current_period_end       timestamptz,
  monthly_usage            integer not null default 0,
  usage_period_start       timestamptz not null default date_trunc('month', now()),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================================================
-- conversions: each run
-- =========================================================
create table if not exists public.conversions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  source_type     text not null check (source_type in ('youtube','url','text')),
  source_input    text not null,
  source_title    text,
  source_content  text,
  outputs         jsonb,
  status          text not null default 'pending' check (status in ('pending','processing','done','error')),
  error_message   text,
  tokens_in       integer,
  tokens_out      integer,
  created_at      timestamptz not null default now()
);

create index if not exists conversions_user_created_idx
  on public.conversions(user_id, created_at desc);

-- =========================================================
-- RLS
-- =========================================================
alter table public.users       enable row level security;
alter table public.conversions enable row level security;
alter table public.plans       enable row level security;

drop policy if exists "users self select"       on public.users;
drop policy if exists "users self update"       on public.users;
drop policy if exists "conversions self select" on public.conversions;
drop policy if exists "conversions self insert" on public.conversions;
drop policy if exists "conversions self update" on public.conversions;
drop policy if exists "plans public select"     on public.plans;

create policy "users self select"
  on public.users for select using (auth.uid() = id);

create policy "users self update"
  on public.users for update using (auth.uid() = id);

create policy "conversions self select"
  on public.conversions for select using (auth.uid() = user_id);

create policy "conversions self insert"
  on public.conversions for insert with check (auth.uid() = user_id);

create policy "conversions self update"
  on public.conversions for update using (auth.uid() = user_id);

create policy "plans public select"
  on public.plans for select using (true);

-- =========================================================
-- reset_monthly_usage: to call from cron (1st of month)
-- =========================================================
create or replace function public.reset_monthly_usage()
returns void
language sql
security definer
as $$
  update public.users
     set monthly_usage = 0,
         usage_period_start = date_trunc('month', now())
   where usage_period_start < date_trunc('month', now());
$$;
