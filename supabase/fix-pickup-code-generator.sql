-- Hotfix for projects where accept_pickup_request used gen_random_bytes(),
-- which may live outside the function's restricted search_path.
begin;

create or replace function public.accept_pickup_request(p_request_id uuid)
returns public.pickup_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.pickup_requests;
  v_supplier_id uuid;
begin
  select * into v_request
  from public.pickup_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'Pickup request not found.'; end if;
  select supplier_id into v_supplier_id
  from public.food_listings
  where id = v_request.listing_id;

  if auth.uid() <> v_supplier_id and not public.is_admin() then
    raise exception 'Only the listing supplier can accept this request.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been handled.';
  end if;

  update public.pickup_requests
  set status = 'accepted',
      pickup_code = 'AHL-' || lpad(floor(random() * 1000000)::integer::text, 6, '0')
  where id = p_request_id
  returning * into v_request;

  update public.food_listings
  set status = 'reserved'
  where id = v_request.listing_id;

  return v_request;
end;
$$;

revoke all on function public.accept_pickup_request(uuid) from public;
grant execute on function public.accept_pickup_request(uuid) to authenticated;

commit;
