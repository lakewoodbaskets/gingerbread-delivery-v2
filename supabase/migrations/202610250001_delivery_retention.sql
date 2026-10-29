-- Install only after review. No existing delivery or storage object is changed.
-- Retention remains OFF. Only service_role may invoke management functions.
begin;

create table public.delivery_retention_control (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  backup_verified_at timestamptz,
  storage_origin text not null default '',
  lease_token uuid,
  lease_until timestamptz
);
insert into public.delivery_retention_control (id) values (true);

create table public.delivery_file_cleanup (
  path text primary key,
  reason text not null,
  state text not null default 'pending' check (state in ('pending', 'processing', 'deleted')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  last_error text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index delivery_file_cleanup_pending on public.delivery_file_cleanup (next_attempt_at) where state <> 'deleted';

create table public.delivery_retention_runs (
  id uuid primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  archived integer not null default 0,
  deliveries_deleted integer not null default 0,
  files_deleted integer not null default 0,
  files_failed integer not null default 0,
  error text
);

alter table public.delivery_retention_control enable row level security;
alter table public.delivery_file_cleanup enable row level security;
alter table public.delivery_retention_runs enable row level security;
revoke all on public.delivery_retention_control, public.delivery_file_cleanup, public.delivery_retention_runs from public, anon, authenticated;
grant all on public.delivery_retention_control, public.delivery_file_cleanup, public.delivery_retention_runs to service_role;

-- Accept only exact URLs from this project's configured origin and proof bucket.
create function public.delivery_proof_path(value text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare origin text; encoded text; result text; bytes bytea := ''::bytea; i integer := 1; ch text;
begin
  select storage_origin into origin from public.delivery_retention_control where id;
  if coalesce(origin, '') = '' then return null; end if;
  if left(value, length(origin) + 1) <> origin || '/' then return null; end if;
  encoded := substring(value from length(origin) + 1);
  if encoded !~ '^/storage/v1/object/(public|sign)/delivery-proofs/' then return null; end if;
  encoded := split_part(split_part(regexp_replace(encoded, '^/storage/v1/object/(public|sign)/delivery-proofs/', ''), '?', 1), '#', 1);
  while i <= length(encoded) loop
    ch := substr(encoded, i, 1);
    if ch = '%' then
      if substr(encoded, i + 1, 2) !~ '^[0-9A-Fa-f]{2}$' then return null; end if;
      bytes := bytes || decode(substr(encoded, i + 1, 2), 'hex'); i := i + 3;
    else
      bytes := bytes || convert_to(ch, 'UTF8'); i := i + 1;
    end if;
  end loop;
  result := convert_from(bytes, 'UTF8');
  if result = '' or result ~ '(^/|(^|/)\.\.(/|$))' then return null; end if;
  return result;
exception when others then return null;
end $$;

-- Capture deletion intent in the SAME transaction as manual deletion/replacement.
-- Queue rows are permanent tombstones: never reuse an old object path.
create function public.track_delivery_files() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare old_path text; new_path text; field text; queued_state text;
begin
  foreach field in array array['proof_photo_url', 'signature_url'] loop
    old_path := case when tg_op <> 'INSERT' then public.delivery_proof_path(to_jsonb(old)->>field) end;
    new_path := case when tg_op <> 'DELETE' then public.delivery_proof_path(to_jsonb(new)->>field) end;
    if new_path is distinct from old_path and new_path is not null then
      select state into queued_state from public.delivery_file_cleanup where path = new_path for update;
      if found then
        -- A transactional restore may delete and reinsert the same row. Cancel
        -- pending intent only while the object still exists and no worker owns it.
        if queued_state = 'pending' and exists (select 1 from storage.objects where bucket_id = 'delivery-proofs' and name = new_path) then
          delete from public.delivery_file_cleanup where path = new_path;
        else
          raise exception 'This proof file is retired; upload a new file instead.';
        end if;
      end if;
    end if;
    if old_path is not null and old_path is distinct from new_path then
      insert into public.delivery_file_cleanup(path, reason) values (old_path, lower(tg_op)) on conflict (path) do nothing;
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger deliveries_track_files before insert or update or delete on public.deliveries
for each row execute function public.track_delivery_files();

-- Read-only inventory, including full affected rows for a real backup.
create function public.delivery_retention_preview() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare archive_days integer; delete_days integer; report jsonb;
begin
  if (select count(*) from public.settings) <> 1 then raise exception 'Exactly one settings row is required'; end if;
  select archive_after_days, delete_after_days into archive_days, delete_days from public.settings;
  if archive_days is null or delete_days is null or archive_days < 1 or delete_days < archive_days then
    raise exception 'Valid retention settings are required';
  end if;
  if not exists (select 1 from public.delivery_retention_control where id and storage_origin ~ '^https://[^/]+$') then
    raise exception 'Configure storage_origin before previewing retention';
  end if;
  with aged as (
    select d.* from public.deliveries d where status in ('Delivered', 'Failed')
      and completed_at < now() - make_interval(days => delete_days)
  ), expired as (
    select * from aged d where (coalesce(proof_photo_url, '') = '' or public.delivery_proof_path(proof_photo_url) is not null)
      and (coalesce(to_jsonb(d)->>'signature_url', '') = '' or public.delivery_proof_path(to_jsonb(d)->>'signature_url') is not null)
  ), live_refs as materialized (
    select d.id, public.delivery_proof_path(v.url) as path from public.deliveries d
      cross join lateral (values (d.proof_photo_url), (to_jsonb(d)->>'signature_url')) v(url)
      where coalesce(v.url, '') <> ''
  ), candidates as (
    select public.delivery_proof_path(proof_photo_url) as path, 'expired-delivery' as reason from expired
    union select public.delivery_proof_path(to_jsonb(e)->>'signature_url'), 'expired-delivery' from expired e
    union select path, 'queued-file' from public.delivery_file_cleanup where state <> 'deleted'
    union select name, 'old-orphan' from storage.objects o
      where bucket_id = 'delivery-proofs' and greatest(created_at, updated_at) < now() - make_interval(days => delete_days)
        and not exists (select 1 from live_refs where path is null)
        and (metadata->>'mimetype' like 'image/%' or name ~* '\.(jpe?g|png|webp|heic|heif|gif|avif)$')
        and not exists (select 1 from live_refs where path = o.name)
  ), files as (
    select c.path, string_agg(distinct c.reason, ', ' order by c.reason) as reason,
      max((o.metadata->>'size')::bigint) as bytes, max(o.updated_at) as updated_at,
      max(to_jsonb(o)->>'version') as object_version, bool_or(o.id is not null) as exists_in_storage,
      exists (select 1 from live_refs r where r.path = c.path
        and not exists (select 1 from expired e where e.id = r.id)) as shared_with_retained_delivery
    from candidates c left join storage.objects o on o.bucket_id = 'delivery-proofs' and o.name = c.path
    where c.path is not null group by c.path
  )
  select jsonb_build_object(
    'version', 1, 'preview_at', now(), 'archive_after_days', archive_days, 'delete_after_days', delete_days,
    'delete_before', now() - make_interval(days => delete_days),
    'deliveries', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from expired e), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(to_jsonb(f) order by path) from files f), '[]'::jsonb),
    'archive_count', (select count(*) from public.deliveries where status in ('Delivered', 'Failed') and archived_at is null and completed_at < now() - make_interval(days => archive_days)),
    'missing_completed_at_count', (select count(*) from public.deliveries where status in ('Delivered', 'Failed') and completed_at is null),
    'blocked_delivery_count', (select count(*) from aged) - (select count(*) from expired),
    'unrecognized_file_urls', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'field', v.field)) from public.deliveries e
      cross join lateral (values ('proof_photo_url', e.proof_photo_url), ('signature_url', to_jsonb(e)->>'signature_url')) v(field, url)
      where coalesce(v.url, '') <> '' and public.delivery_proof_path(v.url) is null), '[]'::jsonb)
  ) into report;
  return report;
end $$;

-- A short global lease prevents overlapping workers. Switch remains disabled by default.
create function public.delivery_retention_start(run_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.delivery_retention_control set lease_token = run_id, lease_until = now() + interval '10 minutes'
  where id and enabled and backup_verified_at is not null
    and storage_origin ~ '^https://[^/]+$' and (lease_until is null or lease_until < now());
  if not found then return false; end if;
  insert into public.delivery_retention_runs(id) values (run_id);
  return true;
end $$;

create function public.delivery_retention_batch(run_id uuid, batch_size integer default 100) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare archive_days integer; delete_days integer; archived_count integer; deleted_count integer;
begin
  perform 1 from public.delivery_retention_control where id and enabled and lease_token = run_id and lease_until > now() for update;
  if not found then raise exception 'Retention is disabled or the worker lease expired'; end if;
  if (select count(*) from public.settings) <> 1 then raise exception 'Exactly one settings row is required'; end if;
  select archive_after_days, delete_after_days into archive_days, delete_days from public.settings;
  if archive_days is null or archive_days < 1 or delete_days is null or delete_days < archive_days then raise exception 'Invalid retention settings'; end if;
  with selected as (select id from public.deliveries where status in ('Delivered', 'Failed') and archived_at is null
    and completed_at < now() - make_interval(days => archive_days) order by completed_at limit least(greatest(batch_size, 1), 200) for update skip locked)
  update public.deliveries d set archived_at = now() from selected s where d.id = s.id;
  get diagnostics archived_count = row_count;
  -- Snapshot file paths into the queue via the trigger before deleting each row.
  with selected as (select id from public.deliveries where status in ('Delivered', 'Failed')
    and completed_at < now() - make_interval(days => delete_days)
    and (coalesce(proof_photo_url, '') = '' or public.delivery_proof_path(proof_photo_url) is not null)
    and (coalesce(to_jsonb(deliveries)->>'signature_url', '') = '' or public.delivery_proof_path(to_jsonb(deliveries)->>'signature_url') is not null)
    order by completed_at limit least(greatest(batch_size, 1), 200) for update skip locked)
  delete from public.deliveries d using selected s where d.id = s.id;
  get diagnostics deleted_count = row_count;
  with live_refs as materialized (
    select public.delivery_proof_path(v.url) as path from public.deliveries d
      cross join lateral (values (d.proof_photo_url), (to_jsonb(d)->>'signature_url')) v(url)
      where coalesce(v.url, '') <> ''
  ) insert into public.delivery_file_cleanup(path, reason)
    select name, 'old-orphan' from storage.objects o where bucket_id = 'delivery-proofs'
      and not exists (select 1 from live_refs where path is null)
      and greatest(created_at, updated_at) < now() - make_interval(days => delete_days)
      and (metadata->>'mimetype' like 'image/%' or name ~* '\.(jpe?g|png|webp|heic|heif|gif|avif)$')
      and not exists (select 1 from live_refs where path = o.name)
      and not exists (select 1 from public.delivery_file_cleanup q where q.path = o.name)
    order by created_at limit least(greatest(batch_size, 1), 200) on conflict (path) do nothing;
  update public.delivery_retention_runs set archived = archived + archived_count, deliveries_deleted = deliveries_deleted + deleted_count where id = run_id;
  return jsonb_build_object('archived', archived_count, 'deliveries_deleted', deleted_count);
end $$;

create function public.delivery_retention_claim_files(run_id uuid, batch_size integer default 50) returns setof text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform 1 from public.delivery_retention_control where id and enabled and lease_token = run_id and lease_until > now() for update;
  if not found then raise exception 'Retention is disabled or the worker lease expired'; end if;
  return query with live_refs as materialized (
    select public.delivery_proof_path(v.url) as path from public.deliveries d
      cross join lateral (values (d.proof_photo_url), (to_jsonb(d)->>'signature_url')) v(url)
      where coalesce(v.url, '') <> ''
  ), selected as (
    select path from public.delivery_file_cleanup q where state <> 'deleted' and next_attempt_at <= now()
      and not exists (select 1 from live_refs where path is null)
      and not exists (select 1 from live_refs r where r.path = q.path)
      order by next_attempt_at limit least(greatest(batch_size, 1), 100) for update skip locked
  ) update public.delivery_file_cleanup q set state = 'processing', lease_token = run_id, attempts = attempts + 1,
      next_attempt_at = now() + interval '15 minutes'
    from selected s where q.path = s.path returning q.path;
end $$;

create function public.delivery_retention_file_result(run_id uuid, file_path text, failure text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.delivery_file_cleanup set state = case when failure is null then 'deleted' else 'pending' end,
    last_error = left(failure, 500), deleted_at = case when failure is null then now() end,
    next_attempt_at = now() + interval '1 hour' * least(24, attempts)
    where path = file_path and lease_token = run_id and state = 'processing';
  if found then
    update public.delivery_retention_runs set files_deleted = files_deleted + case when failure is null then 1 else 0 end,
      files_failed = files_failed + case when failure is null then 0 else 1 end where id = run_id;
  end if;
end $$;

create function public.delivery_retention_finish(run_id uuid, failure text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.delivery_retention_runs set finished_at = now(), error = left(failure, 500) where id = run_id;
  update public.delivery_retention_control set lease_token = null, lease_until = null where id and lease_token = run_id;
end $$;

-- Functions default to PUBLIC execution in PostgreSQL: explicitly close every entry point.
revoke all on function public.delivery_proof_path(text), public.track_delivery_files(),
  public.delivery_retention_preview(), public.delivery_retention_start(uuid), public.delivery_retention_batch(uuid, integer),
  public.delivery_retention_claim_files(uuid, integer), public.delivery_retention_file_result(uuid, text, text), public.delivery_retention_finish(uuid, text)
  from public, anon, authenticated;
grant execute on function public.delivery_retention_preview(), public.delivery_retention_start(uuid), public.delivery_retention_batch(uuid, integer),
  public.delivery_retention_claim_files(uuid, integer), public.delivery_retention_file_result(uuid, text, text), public.delivery_retention_finish(uuid, text)
  to service_role;
commit;
