-- Production-safe order number allocation for Gingerbread Delivery.
--
-- This script does not update, renumber, delete, or merge any existing
-- deliveries. Existing repeated order_no values remain untouched.

alter table public.deliveries
  add column if not exists order_sequence_no bigint;

create sequence if not exists public.delivery_order_number_seq;

select setval(
  'public.delivery_order_number_seq',
  greatest(
    1000,
    coalesce((
      select max((regexp_replace(order_no, '\D', '', 'g'))::bigint)
      from public.deliveries
      where order_no is not null
        and regexp_replace(order_no, '\D', '', 'g') <> ''
    ), 1000)
  ),
  true
);

create unique index if not exists deliveries_order_sequence_no_unique
  on public.deliveries (order_sequence_no)
  where order_sequence_no is not null;

create or replace function public.create_delivery_with_order_number(payload jsonb)
returns public.deliveries
language plpgsql
security definer
set search_path = public
as $$
declare
  next_order_number bigint;
  inserted_delivery public.deliveries;
begin
  next_order_number := nextval('public.delivery_order_number_seq');

  insert into public.deliveries (
    order_sequence_no,
    order_no,
    delivery_date,
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
  values (
    next_order_number,
    next_order_number::text,
    coalesce(nullif(payload->>'delivery_date', '')::date, current_date),
    coalesce(payload->>'customer_name', ''),
    coalesce(payload->>'phone', ''),
    coalesce(payload->>'address', ''),
    coalesce(payload->>'driver', ''),
    coalesce(nullif(payload->>'priority', ''), 'Normal'),
    greatest(coalesce(nullif(payload->>'package_count', '')::integer, 1), 1),
    coalesce(nullif(payload->>'status', ''), 'New'),
    coalesce(payload->>'notes', ''),
    coalesce(payload->>'receiver_name', ''),
    coalesce(payload->>'proof_photo_url', ''),
    coalesce(payload->>'signature_url', ''),
    coalesce(payload->>'failed_reason', ''),
    nullif(payload->>'completed_at', '')::timestamptz,
    nullif(payload->>'archived_at', '')::timestamptz
  )
  returning * into inserted_delivery;

  return inserted_delivery;
end;
$$;

grant execute on function public.create_delivery_with_order_number(jsonb) to anon;
