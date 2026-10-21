-- The Bound Vigil: sync setup for a Supabase project.
--
-- Run this once in your project's SQL Editor (Supabase › SQL Editor › New
-- query, paste, Run). Running it again is safe. Use a project made for TBV:
-- this adds a table, two functions and a storage bucket, nothing else.
--
-- What it makes:
--   tbv_records  one row per synced thing (a book, a note, a collection…),
--                newest change kept, readable only by the person who owns it.
--   tbv_push     how TBV sends changes: an older change never replaces a newer one.
--   tbv_usage    how much TBV is using, for the gauge in Settings › Sync.
--   tbv-files    a private bucket for book files, covers and collection pictures,
--                each person's in a folder only they can open.

create sequence if not exists public.tbv_records_seq;

create table if not exists public.tbv_records (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null,
  key text not null,
  data jsonb,
  changed_at text collate "C" not null,
  device_id text,
  seq bigint not null default nextval('public.tbv_records_seq'),
  primary key (user_id, kind, key)
);

create index if not exists tbv_records_user_seq on public.tbv_records (user_id, seq);

alter table public.tbv_records enable row level security;

drop policy if exists "TBV: people see their own records" on public.tbv_records;
create policy "TBV: people see their own records" on public.tbv_records
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "TBV: people add their own records" on public.tbv_records;
create policy "TBV: people add their own records" on public.tbv_records
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "TBV: people change their own records" on public.tbv_records;
create policy "TBV: people change their own records" on public.tbv_records
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.tbv_records from anon, public;
grant select, insert, update on public.tbv_records to authenticated;
revoke all on sequence public.tbv_records_seq from anon, public;
grant usage on sequence public.tbv_records_seq to authenticated;

-- Stores a batch of changes. One person's batches go through one at a time,
-- so the order (seq) never runs backwards and no device misses a change.
create or replace function public.tbv_push(records jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'sign in first' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text, 0));
  insert into public.tbv_records as r (user_id, kind, key, data, changed_at, device_id)
  select me, x.kind, x.key, x.data, x.changed_at, x.device_id
  from jsonb_to_recordset(records) as x(kind text, key text, data jsonb, changed_at text, device_id text)
  on conflict (user_id, kind, key) do update
    set data = excluded.data,
        changed_at = excluded.changed_at,
        device_id = excluded.device_id,
        seq = nextval('public.tbv_records_seq')
    where excluded.changed_at > r.changed_at;
end;
$$;

revoke all on function public.tbv_push(jsonb) from anon, public;
grant execute on function public.tbv_push(jsonb) to authenticated;

-- Files. Each person's live under a folder named after their account.
insert into storage.buckets (id, name, public)
values ('tbv-files', 'tbv-files', false)
on conflict (id) do nothing;

drop policy if exists "TBV: people read their own files" on storage.objects;
create policy "TBV: people read their own files" on storage.objects
  for select to authenticated
  using (bucket_id = 'tbv-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "TBV: people add their own files" on storage.objects;
create policy "TBV: people add their own files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tbv-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "TBV: people replace their own files" on storage.objects;
create policy "TBV: people replace their own files" on storage.objects
  for update to authenticated
  using (bucket_id = 'tbv-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'tbv-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "TBV: people remove their own files" on storage.objects;
create policy "TBV: people remove their own files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tbv-files' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- How much TBV is using, for the gauge in Settings › Sync: the database's
-- size and the signed-in person's files, added up by folder.
create or replace function public.tbv_usage()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'database_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'folders', coalesce((
      select pg_catalog.jsonb_object_agg(f.folder, pg_catalog.jsonb_build_object('bytes', f.bytes, 'files', f.files))
      from (
        select coalesce((storage.foldername(o.name))[2], '') as folder,
               sum(coalesce((o.metadata->>'size')::bigint, 0)) as bytes,
               count(*) as files
        from storage.objects o
        where o.bucket_id = 'tbv-files' and (storage.foldername(o.name))[1] = (select auth.uid())::text
        group by 1
      ) f
    ), '{}'::jsonb)
  );
$$;

revoke all on function public.tbv_usage() from anon, public;
grant execute on function public.tbv_usage() to authenticated;

-- Ask the Data API to notice the new table and function straight away.
notify pgrst, 'reload schema';
