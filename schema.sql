-- =========================================================
-- Pure Studio Supabase Database Setup
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)
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

-- 4. Enable Row Level Security (RLS)
alter table public.clients enable row level security;
alter table public.invoices enable row level security;
alter table public.settings enable row level security;

-- 5. Create RLS Policies to allow anonymous public read/write access
create policy "Allow all operations for anon on clients" on public.clients for all using (true) with check (true);
create policy "Allow all operations for anon on invoices" on public.invoices for all using (true) with check (true);
create policy "Allow all operations for anon on settings" on public.settings for all using (true) with check (true);

-- 6. Enable Realtime Publications for live multi-device syncing
alter publication supabase_realtime add table public.clients;
alter publication supabase_realtime add table public.invoices;
alter publication supabase_realtime add table public.settings;
