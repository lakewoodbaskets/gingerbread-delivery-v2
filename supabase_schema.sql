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
