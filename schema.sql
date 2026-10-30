-- =========================================================
-- Pure Studio Supabase Database Setup (idempotent — safe to re-run)
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)
--
-- The app talks to these tables ONLY through its own /api functions using the
-- service-role key, so the public anon key gets no access at all.
-- =========================================================

-- 1. Clients Table
create table if not exists public.clients (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 2. Invoices Table
create table if not exists public.invoices (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 3. Settings Table
create table if not exists public.settings (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- 4. Cash Dealings Table (kept separate from GST invoices, no tax fields)
create table if not exists public.cash_entries (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 4b. Expenses (any kind of cost; status paid/unpaid lives inside the data)
create table if not exists public.expenses (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- 5. Login attempt log (drives rate limiting + auto-blocking)
create table if not exists public.auth_attempts (
  id bigint generated always as identity primary key,
  created_at timestamp with time zone not null default now(),
  ip text not null,
  device_id text,
  user_agent text,
  username text,
  success boolean not null
);
create index if not exists auth_attempts_ip_idx on public.auth_attempts (ip, created_at desc);
create index if not exists auth_attempts_device_idx on public.auth_attempts (device_id, created_at desc);

-- 6. IP / device blocklist (expires_at null = until removed)
create table if not exists public.blocked_entities (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('ip', 'device')),
  value text not null,
  reason text,
  source text not null default 'manual',
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone,
  unique (kind, value)
);

-- 7. Small key/value store for auth state: holds the site password (scrypt hash, never the password itself).
--    Delete the row with key = 'password_hash' to run the first-time password setup again.
create table if not exists public.auth_state (
  key text primary key,
  value text not null,
  updated_at timestamp with time zone not null default now()
);

-- 8. Lock everything down: RLS on, NO policies, no grants for the public roles.
--    (The service-role key used by /api bypasses RLS.)
alter table public.clients enable row level security;
alter table public.invoices enable row level security;
alter table public.settings enable row level security;
alter table public.cash_entries enable row level security;
alter table public.expenses enable row level security;
alter table public.auth_attempts enable row level security;
alter table public.blocked_entities enable row level security;
alter table public.auth_state enable row level security;

-- Remove the old "anyone with the anon key can read/write" policies from earlier versions
drop policy if exists "Allow all operations for anon on clients" on public.clients;
drop policy if exists "Allow all operations for anon on invoices" on public.invoices;
drop policy if exists "Allow all operations for anon on settings" on public.settings;
drop policy if exists "Allow all operations for anon on cash_entries" on public.cash_entries;

revoke all on table public.clients, public.invoices, public.settings, public.cash_entries, public.expenses,
  public.auth_attempts, public.blocked_entities, public.auth_state from anon, authenticated;
