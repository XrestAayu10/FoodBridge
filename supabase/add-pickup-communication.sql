-- Adds consent-based partner contact sharing for accepted pickups.
begin;

alter table public.users
  add column if not exists share_phone_on_accept boolean not null default false;

create or replace function public.get_pickup_contacts(p_request_id uuid)
returns table (
  supplier_user_id uuid, supplier_name text, supplier_email text, supplier_phone text,
  organization_user_id uuid, organization_name text, organization_email text, organization_phone text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    supplier.id,
    supplier.name,
    supplier.email,
    case when pr.status in ('accepted', 'collected') and supplier.share_phone_on_accept then supplier.phone end,
    org_user.id,
    org.name,
    org_user.email,
    case when pr.status in ('accepted', 'collected') and org_user.share_phone_on_accept then org_user.phone end
  from public.pickup_requests pr
  join public.food_listings fl on fl.id = pr.listing_id
  join public.users supplier on supplier.id = fl.supplier_id
  join public.organizations org on org.id = pr.organization_id
  join public.users org_user on org_user.id = org.user_id
  where pr.id = p_request_id
    and pr.status in ('pending', 'accepted', 'collected')
    and (supplier.id = auth.uid() or org_user.id = auth.uid() or public.is_admin());
$$;

create or replace function public.create_pickup_request(p_listing_id uuid, p_organization_id uuid, p_requested_quantity text)
returns public.pickup_requests
language plpgsql security definer set search_path = public
as $$
declare v_listing public.food_listings; v_request public.pickup_requests;
begin
  select * into v_listing from public.food_listings where id = p_listing_id for update;
  if not found or v_listing.status <> 'available' then raise exception 'This food listing is no longer available.'; end if;
  if not exists (
    select 1 from public.organizations
    where id = p_organization_id and user_id = auth.uid() and verification_status = 'approved'
  ) then raise exception 'Only a verified organization can request this pickup.'; end if;

  insert into public.pickup_requests (listing_id, organization_id, requested_quantity, status)
  values (p_listing_id, p_organization_id, coalesce(nullif(trim(p_requested_quantity), ''), v_listing.quantity), 'pending')
  returning * into v_request;
  update public.food_listings set status = 'requested' where id = p_listing_id;
  return v_request;
end;
$$;

create or replace function public.accept_pickup_request(p_request_id uuid)
returns public.pickup_requests
language plpgsql security definer set search_path = public
as $$
declare v_request public.pickup_requests; v_supplier_id uuid;
begin
  select * into v_request from public.pickup_requests where id = p_request_id for update;
  if not found then raise exception 'Pickup request not found.'; end if;
  select supplier_id into v_supplier_id from public.food_listings where id = v_request.listing_id;
  if auth.uid() <> v_supplier_id and not public.is_admin() then raise exception 'Only the listing supplier can accept this request.'; end if;
  if v_request.status <> 'pending' then raise exception 'This request has already been handled.'; end if;

  update public.pickup_requests
  set status = 'accepted', pickup_code = 'AHL-' || lpad(floor(random() * 1000000)::integer::text, 6, '0')
  where id = p_request_id returning * into v_request;
  update public.food_listings set status = 'reserved' where id = v_request.listing_id;
  return v_request;
end;
$$;

create or replace function public.reject_pickup_request(p_request_id uuid)
returns public.pickup_requests
language plpgsql security definer set search_path = public
as $$
declare v_request public.pickup_requests; v_supplier_id uuid;
begin
  select * into v_request from public.pickup_requests where id = p_request_id for update;
  if not found then raise exception 'Pickup request not found.'; end if;
  select supplier_id into v_supplier_id from public.food_listings where id = v_request.listing_id;
  if auth.uid() <> v_supplier_id and not public.is_admin() then raise exception 'Only the listing supplier can reject this request.'; end if;
  if v_request.status <> 'pending' then raise exception 'This request has already been handled.'; end if;
  update public.pickup_requests set status = 'rejected' where id = p_request_id returning * into v_request;
  update public.food_listings set status = 'available' where id = v_request.listing_id;
  return v_request;
end;
$$;

create or replace function public.confirm_pickup_collection(p_request_id uuid, p_pickup_code text default null)
returns public.pickup_requests
language plpgsql security definer set search_path = public
as $$
declare
  v_request public.pickup_requests;
  v_supplier_id uuid;
  v_organization_user_id uuid;
  v_is_supplier boolean;
  v_is_organization boolean;
begin
  select * into v_request from public.pickup_requests where id = p_request_id for update;
  if not found then raise exception 'Pickup request not found.'; end if;
  if v_request.status <> 'accepted' then raise exception 'This pickup is not ready for confirmation.'; end if;
  select supplier_id into v_supplier_id from public.food_listings where id = v_request.listing_id;
  select user_id into v_organization_user_id from public.organizations where id = v_request.organization_id;
  v_is_supplier := auth.uid() = v_supplier_id;
  v_is_organization := auth.uid() = v_organization_user_id;
  if not v_is_supplier and not v_is_organization then raise exception 'Only this pickup''s supplier or organization can confirm it.'; end if;

  if v_is_supplier then
    if regexp_replace(upper(coalesce(p_pickup_code, '')), '[^A-Z0-9]', '', 'g')
       <> regexp_replace(upper(coalesce(v_request.pickup_code, '')), '[^A-Z0-9]', '', 'g') then
      raise exception 'That pickup code does not match.';
    end if;
    update public.pickup_requests set supplier_confirmed_at = coalesce(supplier_confirmed_at, now()) where id = p_request_id;
  else
    update public.pickup_requests set organization_confirmed_at = coalesce(organization_confirmed_at, now()) where id = p_request_id;
  end if;

  select * into v_request from public.pickup_requests where id = p_request_id;
  if v_request.supplier_confirmed_at is not null and v_request.organization_confirmed_at is not null then
    update public.pickup_requests set status = 'collected' where id = p_request_id returning * into v_request;
    update public.food_listings set status = 'collected' where id = v_request.listing_id;
  end if;
  return v_request;
end;
$$;

create or replace function public.set_organization_verification(p_organization_id uuid, p_status text)
returns public.organizations
language plpgsql security definer set search_path = public
as $$
declare v_organization public.organizations;
begin
  if not public.is_admin() then raise exception 'Only an admin can verify organizations.'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Invalid verification status.'; end if;
  update public.organizations set verification_status = p_status where id = p_organization_id
  returning * into v_organization;
  if not found then raise exception 'Organization not found.'; end if;
  return v_organization;
end;
$$;

revoke all on function public.get_pickup_contacts(uuid) from public;
grant execute on function public.get_pickup_contacts(uuid) to authenticated;
revoke all on function public.create_pickup_request(uuid, uuid, text) from public;
revoke all on function public.accept_pickup_request(uuid) from public;
revoke all on function public.reject_pickup_request(uuid) from public;
revoke all on function public.confirm_pickup_collection(uuid, text) from public;
grant execute on function public.create_pickup_request(uuid, uuid, text) to authenticated;
grant execute on function public.accept_pickup_request(uuid) to authenticated;
grant execute on function public.reject_pickup_request(uuid) to authenticated;
grant execute on function public.confirm_pickup_collection(uuid, text) to authenticated;
revoke all on function public.set_organization_verification(uuid, text) from public;
grant execute on function public.set_organization_verification(uuid, text) to authenticated;

drop policy if exists "listings_update_own_or_admin" on public.food_listings;
create policy "listings_update_own_or_admin" on public.food_listings
  for update using (supplier_id = auth.uid() or public.is_admin());

drop policy if exists "requests_update_participants_or_admin" on public.pickup_requests;
create policy "requests_update_participants_or_admin" on public.pickup_requests
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "requests_insert_approved_org_only" on public.pickup_requests;
drop policy if exists "requests_insert_admin_only" on public.pickup_requests;
create policy "requests_insert_admin_only" on public.pickup_requests
  for insert with check (public.is_admin());

drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own" on public.users
  for insert with check (auth.uid() = id and role in ('supplier', 'organization'));

drop policy if exists "organizations_insert_own" on public.organizations;
create policy "organizations_insert_own" on public.organizations
  for insert with check (user_id = auth.uid() and verification_status = 'pending');

revoke update on table public.users from authenticated;
grant update (name, phone, share_phone_on_accept) on table public.users to authenticated;
revoke update on table public.organizations from authenticated;
grant update (name, address, community_served, document_url) on table public.organizations to authenticated;

commit;
