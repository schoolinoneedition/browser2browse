-- Browse2Browse optional cross-device preferences, history and bookmarks.
-- Browser cookies, live page contents and session tokens are intentionally not stored.
create table if not exists public.b2b_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object'),
  recent_sites jsonb not null default '[]'::jsonb check (jsonb_typeof(recent_sites) = 'array'),
  bookmarks jsonb not null default '[]'::jsonb check (jsonb_typeof(bookmarks) = 'array'),
  updated_at timestamptz not null default now()
);
alter table public.b2b_user_data enable row level security;
revoke all on table public.b2b_user_data from anon;
grant select, insert, update, delete on public.b2b_user_data to authenticated;
drop policy if exists b2b_user_data_select_own on public.b2b_user_data;
create policy b2b_user_data_select_own on public.b2b_user_data for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists b2b_user_data_insert_own on public.b2b_user_data;
create policy b2b_user_data_insert_own on public.b2b_user_data for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists b2b_user_data_update_own on public.b2b_user_data;
create policy b2b_user_data_update_own on public.b2b_user_data for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists b2b_user_data_delete_own on public.b2b_user_data;
create policy b2b_user_data_delete_own on public.b2b_user_data for delete to authenticated
  using ((select auth.uid()) = user_id);
