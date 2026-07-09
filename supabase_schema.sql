create table if not exists public.settings (
  id bigint primary key default 1,
  company_name text not null default 'Gingerbread Delivery',
  office_pin text not null default '7933',
  archive_after_days integer not null default 7,
  delete_after_days integer not null default 30,
  logo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settings_singleton check (id = 1)
);

insert into public.settings (
  id,
  company_name,
  office_pin,
  archive_after_days,
  delete_after_days,
  logo_url
)
values (
  1,
  'Gingerbread Delivery',
  '7933',
  7,
  30,
  ''
)
on conflict (id) do nothing;

create or replace function public.set_settings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists settings_set_updated_at on public.settings;

create trigger settings_set_updated_at
before update on public.settings
for each row
execute function public.set_settings_updated_at();


-- Storage bucket for delivery proof photos.
insert into storage.buckets (id, name, public)
values ('delivery-proofs', 'delivery-proofs', true)
on conflict (id) do update set public = true;

-- Allow proof photo uploads and reads from the app's anon client.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'delivery_proofs_insert'
  ) then
    create policy delivery_proofs_insert
    on storage.objects
    for insert
    to anon
    with check (bucket_id = 'delivery-proofs');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'delivery_proofs_select'
  ) then
    create policy delivery_proofs_select
    on storage.objects
    for select
    to anon
    using (bucket_id = 'delivery-proofs');
  end if;
end $$;


-- Add order priority for deliveries.
alter table public.deliveries
add column if not exists priority text not null default 'Normal';

alter table public.deliveries
drop constraint if exists deliveries_priority_check;

alter table public.deliveries
add constraint deliveries_priority_check check (priority in ('Normal', 'Priority'));


-- Add package count for deliveries.
alter table public.deliveries
add column if not exists package_count integer not null default 1;

alter table public.deliveries
drop constraint if exists deliveries_package_count_check;

alter table public.deliveries
add constraint deliveries_package_count_check check (package_count >= 1);


-- Transactional Backup Restore RPC.
-- Run this before using Restore Backup in production.
create or replace function public.restore_backup(backup_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((backup_payload->>'version')::integer, 0) <> 1 then
    raise exception 'Unsupported backup version';
  end if;

  if jsonb_typeof(backup_payload->'deliveries') <> 'array' then
    raise exception 'Backup deliveries must be an array';
  end if;

  if jsonb_typeof(backup_payload->'drivers') <> 'array' then
    raise exception 'Backup drivers must be an array';
  end if;

  if jsonb_typeof(backup_payload->'settings') <> 'object' then
    raise exception 'Backup settings must be an object';
  end if;

  delete from public.deliveries;
  delete from public.drivers;

  insert into public.deliveries (
    id,
    created_at,
    updated_at,
    delivery_date,
    order_no,
    customer_name,
    phone,
    address,
    driver,
    priority,
    package_count,
    status,
    notes,
    receiver_name,
    proof_photo_url,
    signature_url,
    failed_reason,
    completed_at,
    archived_at
  )
  select
    id,
    coalesce(created_at, now()),
    updated_at,
    delivery_date,
    order_no,
    customer_name,
    phone,
    address,
    coalesce(driver, ''),
    coalesce(priority, 'Normal'),
    coalesce(package_count, 1),
    coalesce(status, 'New'),
    coalesce(notes, ''),
    coalesce(receiver_name, ''),
    coalesce(proof_photo_url, ''),
    coalesce(signature_url, ''),
    coalesce(failed_reason, ''),
    completed_at,
    archived_at
  from jsonb_to_recordset(backup_payload->'deliveries') as delivery_rows(
    id uuid,
    created_at timestamptz,
    updated_at timestamptz,
    delivery_date date,
    order_no text,
    customer_name text,
    phone text,
    address text,
    driver text,
    priority text,
    package_count integer,
    status text,
    notes text,
    receiver_name text,
    proof_photo_url text,
    signature_url text,
    failed_reason text,
    completed_at timestamptz,
    archived_at timestamptz
  );

  insert into public.drivers (
    id,
    created_at,
    name,
    pin,
    active
  )
  select
    id,
    coalesce(created_at, now()),
    name,
    pin,
    coalesce(active, true)
  from jsonb_to_recordset(backup_payload->'drivers') as driver_rows(
    id uuid,
    created_at timestamptz,
    name text,
    pin text,
    active boolean
  );

  insert into public.settings (
    id,
    company_name,
    office_pin,
    archive_after_days,
    delete_after_days,
    logo_url,
    created_at,
    updated_at
  )
  values (
    1,
    backup_payload->'settings'->>'company_name',
    backup_payload->'settings'->>'office_pin',
    coalesce((backup_payload->'settings'->>'archive_after_days')::integer, 7),
    coalesce((backup_payload->'settings'->>'delete_after_days')::integer, 30),
    coalesce(backup_payload->'settings'->>'logo_url', ''),
    coalesce((backup_payload->'settings'->>'created_at')::timestamptz, now()),
    now()
  )
  on conflict (id) do update set
    company_name = excluded.company_name,
    office_pin = excluded.office_pin,
    archive_after_days = excluded.archive_after_days,
    delete_after_days = excluded.delete_after_days,
    logo_url = excluded.logo_url,
    updated_at = now();
end;
$$;

grant execute on function public.restore_backup(jsonb) to anon;
