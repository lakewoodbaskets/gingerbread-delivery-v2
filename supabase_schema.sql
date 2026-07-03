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
