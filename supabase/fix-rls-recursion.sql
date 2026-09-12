-- Repair migration for:
--   infinite recursion detected in policy for relation "food_listings"
--
-- Cause: the food_listings SELECT policy queried pickup_requests while the
-- pickup_requests SELECT/UPDATE policies queried food_listings. PostgreSQL
-- applies RLS to both nested reads, creating a policy loop.

begin;

create or replace function public.listing_has_org_request(p_listing_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.pickup_requests pr
    join public.organizations o on o.id = pr.organization_id
    where pr.listing_id = p_listing_id
      and o.user_id = auth.uid()
  );
$$;

create or replace function public.listing_supplier_is_me(p_listing_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.food_listings fl
    where fl.id = p_listing_id
      and fl.supplier_id = auth.uid()
  );
$$;

revoke all on function public.listing_has_org_request(uuid) from public;
revoke all on function public.listing_supplier_is_me(uuid) from public;
grant execute on function public.listing_has_org_request(uuid) to authenticated;
grant execute on function public.listing_supplier_is_me(uuid) to authenticated;

drop policy if exists "listings_select_visible" on public.food_listings;
create policy "listings_select_visible" on public.food_listings
  for select
  to authenticated
  using (
    status = 'available'
    or supplier_id = auth.uid()
    or public.is_admin()
    or public.listing_has_org_request(id)
  );

drop policy if exists "requests_select_participants_or_admin" on public.pickup_requests;
create policy "requests_select_participants_or_admin" on public.pickup_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organizations o
      where o.id = organization_id
        and o.user_id = auth.uid()
    )
    or public.listing_supplier_is_me(listing_id)
    or public.is_admin()
  );

drop policy if exists "requests_update_participants_or_admin" on public.pickup_requests;
create policy "requests_update_participants_or_admin" on public.pickup_requests
  for update
  to authenticated
  using (
    public.listing_supplier_is_me(listing_id)
    or exists (
      select 1
      from public.organizations o
      where o.id = organization_id
        and o.user_id = auth.uid()
    )
    or public.is_admin()
  )
  with check (
    public.listing_supplier_is_me(listing_id)
    or exists (
      select 1
      from public.organizations o
      where o.id = organization_id
        and o.user_id = auth.uid()
    )
    or public.is_admin()
  );

commit;

