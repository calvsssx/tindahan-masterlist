-- Tindahan Master List — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Database > SQL Editor > New query).
-- Safe to re-run: it drops and recreates the policies.

create table if not exists items (
  id bigint primary key,
  name text not null,
  category text not null,
  unit_price numeric,
  wholesale_price numeric,
  retail_price numeric,
  price_history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row Level Security: with RLS on and no policy matching, every request is
-- denied. Nothing can read or write this table except through a policy below.
alter table items enable row level security;

-- Recreate cleanly on re-run.
drop policy if exists "authenticated read"   on items;
drop policy if exists "authenticated insert" on items;
drop policy if exists "authenticated update" on items;
drop policy if exists "authenticated delete" on items;
drop policy if exists "items_select" on items;
drop policy if exists "items_insert" on items;
drop policy if exists "items_update" on items;
drop policy if exists "items_delete" on items;

-- Any signed-in user can read and write the whole shared list (both phones,
-- one list — that's the point). `to authenticated` means the anonymous role
-- is never granted access by these policies, even if one is later loosened.
-- `auth.uid() is not null` rejects a token that somehow isn't a real user.
create policy "items_select" on items
  for select to authenticated
  using (auth.uid() is not null);

create policy "items_insert" on items
  for insert to authenticated
  with check (auth.uid() is not null);

create policy "items_update" on items
  for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

create policy "items_delete" on items
  for delete to authenticated
  using (auth.uid() is not null);

-- Realtime is intentionally NOT enabled: the app polls its own /api instead,
-- so no Supabase key ever has to reach the browser for a WebSocket handshake.
-- If you previously ran `alter publication supabase_realtime add table items;`
-- you can remove it with:
--   alter publication supabase_realtime drop table items;
