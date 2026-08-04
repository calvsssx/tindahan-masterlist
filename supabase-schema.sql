-- Tindahan Master List — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Database > SQL Editor > New query)

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

-- Row Level Security: required by Supabase before the table can be read/written
-- from the browser using the public "anon" key.
alter table items enable row level security;

-- Only signed-in users (via Supabase Auth) can read/write. There's still no
-- per-user split — anyone who has an account can see and edit the whole
-- shared list, which is the point (both phones, same list). If you ever
-- want per-store isolation, you'd add a store_id column and filter on it.
create policy "authenticated read" on items
  for select using (auth.role() = 'authenticated');

create policy "authenticated insert" on items
  for insert with check (auth.role() = 'authenticated');

create policy "authenticated update" on items
  for update using (auth.role() = 'authenticated');

create policy "authenticated delete" on items
  for delete using (auth.role() = 'authenticated');

-- Realtime: lets both phones see each other's edits live, without refreshing.
-- If this errors saying the table is already added, that's fine — ignore it.
alter publication supabase_realtime add table items;
