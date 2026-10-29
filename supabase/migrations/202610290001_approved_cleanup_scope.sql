-- Temporary allowlists constrain an owner-approved first cleanup. NULL restores
-- the ordinary retention policy after that cleanup has been verified.
begin;
alter table public.delivery_retention_control
  add column approved_delivery_ids uuid[],
  add column approved_file_paths text[],
  add constraint retention_scope_pair check ((approved_delivery_ids is null) = (approved_file_paths is null));

create function public.guard_approved_delivery_cleanup() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.delivery_retention_control
    where id and enabled and approved_delivery_ids is not null
      and not (old.id = any(approved_delivery_ids))) then
    raise exception 'Delivery is outside the approved first-cleanup inventory';
  end if;
  return old;
end $$;
create trigger deliveries_approved_cleanup_guard before delete on public.deliveries
for each row execute function public.guard_approved_delivery_cleanup();

create function public.guard_approved_file_cleanup() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.state = 'processing' and exists (select 1 from public.delivery_retention_control
    where id and enabled and approved_file_paths is not null
      and not (new.path = any(approved_file_paths))) then
    raise exception 'File is outside the approved first-cleanup inventory';
  end if;
  return new;
end $$;
create trigger delivery_files_approved_cleanup_guard before update on public.delivery_file_cleanup
for each row execute function public.guard_approved_file_cleanup();
revoke all on function public.guard_approved_delivery_cleanup(), public.guard_approved_file_cleanup() from public, anon, authenticated;
commit;
