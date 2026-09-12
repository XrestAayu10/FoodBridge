-- =============================================================================
-- FoodBridge — Supabase schema, Row Level Security policies, and seed data
-- Run this whole file in the Supabase dashboard: SQL Editor > New query > Run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  email text not null unique,
  phone text,
  share_phone_on_accept boolean not null default false,
  role text not null check (role in ('supplier', 'organization', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

-- `create table if not exists` does not add newly introduced columns when
-- the table already exists. Keep this idempotent upgrade directly after the
-- table declaration so later functions can safely reference the column.
alter table public.users
  add column if not exists share_phone_on_accept boolean not null default false;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  address text,
  community_served text,
  document_url text,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.food_listings (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.users (id) on delete cascade,
  food_name text not null,
  food_type text,
  quantity text not null,
  prepared_at timestamptz,
  pickup_deadline timestamptz not null,
  location text not null,
  lat double precision,
  lng double precision,
  photo_url text,
  safety_confirmed boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'available', 'requested', 'reserved', 'collected', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.pickup_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.food_listings (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  requested_quantity text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'collected')),
  pickup_code text,
  supplier_confirmed_at timestamptz,
  organization_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type text not null,
  channel text not null default 'email',
  sent_at timestamptz not null default now()
);

create index if not exists idx_food_listings_status on public.food_listings (status);
create index if not exists idx_food_listings_supplier on public.food_listings (supplier_id);
create index if not exists idx_pickup_requests_listing on public.pickup_requests (listing_id);
create index if not exists idx_pickup_requests_org on public.pickup_requests (organization_id);
create index if not exists idx_organizations_user on public.organizations (user_id);

-- ---------------------------------------------------------------------------
-- Helper: is_admin() — security definer so it can read `users` without
-- being blocked by the very RLS policy it's used inside of.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  );
$$;

-- Breaks the food_listings <-> pickup_requests RLS cycle: without these,
-- food_listings' policy queries pickup_requests, whose own policy queries
-- food_listings back, causing "infinite recursion detected in policy".
-- security definer functions run with elevated privileges and bypass RLS
-- on the tables they query internally, so no cycle occurs.
create or replace function public.listing_has_org_request(p_listing_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.pickup_requests pr
    join public.organizations o on o.id = pr.organization_id
    where pr.listing_id = p_listing_id and o.user_id = auth.uid()
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
    select 1 from public.food_listings where id = p_listing_id and supplier_id = auth.uid()
  );
$$;

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

-- Pickup state transitions live in guarded database functions instead of
-- trusting browser-supplied status values. Each function locks the request or
-- listing it changes so two people clicking at the same time cannot corrupt
-- the handover state.
create or replace function public.create_pickup_request(
  p_listing_id uuid,
  p_organization_id uuid,
  p_requested_quantity text
)
returns public.pickup_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.food_listings;
  v_request public.pickup_requests;
begin
  select * into v_listing
  from public.food_listings
  where id = p_listing_id
  for update;

  if not found or v_listing.status <> 'available' then
    raise exception 'This food listing is no longer available.';
  end if;

  if not exists (
    select 1 from public.organizations
    where id = p_organization_id
      and user_id = auth.uid()
      and verification_status = 'approved'
  ) then
    raise exception 'Only a verified organization can request this pickup.';
  end if;

  insert into public.pickup_requests (
    listing_id, organization_id, requested_quantity, status
  ) values (
    p_listing_id,
    p_organization_id,
    coalesce(nullif(trim(p_requested_quantity), ''), v_listing.quantity),
    'pending'
  )
  returning * into v_request;

  update public.food_listings set status = 'requested' where id = p_listing_id;
  return v_request;
end;
$$;

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
  select supplier_id into v_supplier_id from public.food_listings where id = v_request.listing_id;

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

  update public.food_listings set status = 'reserved' where id = v_request.listing_id;
  return v_request;
end;
$$;

create or replace function public.reject_pickup_request(p_request_id uuid)
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
  select supplier_id into v_supplier_id from public.food_listings where id = v_request.listing_id;

  if auth.uid() <> v_supplier_id and not public.is_admin() then
    raise exception 'Only the listing supplier can reject this request.';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been handled.';
  end if;

  update public.pickup_requests set status = 'rejected'
  where id = p_request_id
  returning * into v_request;

  update public.food_listings set status = 'available' where id = v_request.listing_id;
  return v_request;
end;
$$;

create or replace function public.confirm_pickup_collection(
  p_request_id uuid,
  p_pickup_code text default null
)
returns public.pickup_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.pickup_requests;
  v_supplier_id uuid;
  v_organization_user_id uuid;
  v_is_supplier boolean;
  v_is_organization boolean;
begin
  select * into v_request
  from public.pickup_requests
  where id = p_request_id
  for update;

  if not found then raise exception 'Pickup request not found.'; end if;
  if v_request.status <> 'accepted' then
    raise exception 'This pickup is not ready for confirmation.';
  end if;

  select supplier_id into v_supplier_id from public.food_listings where id = v_request.listing_id;
  select user_id into v_organization_user_id from public.organizations where id = v_request.organization_id;
  v_is_supplier := auth.uid() = v_supplier_id;
  v_is_organization := auth.uid() = v_organization_user_id;

  if not v_is_supplier and not v_is_organization then
    raise exception 'Only this pickup''s supplier or organization can confirm it.';
  end if;

  if v_is_supplier then
    if regexp_replace(upper(coalesce(p_pickup_code, '')), '[^A-Z0-9]', '', 'g')
       <> regexp_replace(upper(coalesce(v_request.pickup_code, '')), '[^A-Z0-9]', '', 'g') then
      raise exception 'That pickup code does not match.';
    end if;
    update public.pickup_requests
    set supplier_confirmed_at = coalesce(supplier_confirmed_at, now())
    where id = p_request_id;
  else
    update public.pickup_requests
    set organization_confirmed_at = coalesce(organization_confirmed_at, now())
    where id = p_request_id;
  end if;

  select * into v_request from public.pickup_requests where id = p_request_id;
  if v_request.supplier_confirmed_at is not null
     and v_request.organization_confirmed_at is not null then
    update public.pickup_requests set status = 'collected'
    where id = p_request_id
    returning * into v_request;
    update public.food_listings set status = 'collected' where id = v_request.listing_id;
  end if;

  return v_request;
end;
$$;

create or replace function public.set_organization_verification(
  p_organization_id uuid,
  p_status text
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare v_organization public.organizations;
begin
  if not public.is_admin() then raise exception 'Only an admin can verify organizations.'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Invalid verification status.'; end if;
  update public.organizations set verification_status = p_status
  where id = p_organization_id
  returning * into v_organization;
  if not found then raise exception 'Organization not found.'; end if;
  return v_organization;
end;
$$;

revoke all on function public.listing_has_org_request(uuid) from public;
revoke all on function public.listing_supplier_is_me(uuid) from public;
grant execute on function public.listing_has_org_request(uuid) to authenticated;
grant execute on function public.listing_supplier_is_me(uuid) to authenticated;
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

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.organizations enable row level security;
alter table public.food_listings enable row level security;
alter table public.pickup_requests enable row level security;
alter table public.notifications enable row level security;

-- users: everyone can read/update only their own row; admins can read/update all.
drop policy if exists "users_select_own_or_admin" on public.users;
create policy "users_select_own_or_admin" on public.users
  for select using (auth.uid() = id or public.is_admin());

drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own" on public.users
  for insert with check (auth.uid() = id and role in ('supplier', 'organization'));

drop policy if exists "users_update_own_or_admin" on public.users;
create policy "users_update_own_or_admin" on public.users
  for update using (auth.uid() = id or public.is_admin());

-- organizations: org owner and admins can read/update; owner can insert own row.
drop policy if exists "organizations_select_own_or_admin" on public.organizations;
create policy "organizations_select_own_or_admin" on public.organizations
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "organizations_insert_own" on public.organizations;
create policy "organizations_insert_own" on public.organizations
  for insert with check (user_id = auth.uid() and verification_status = 'pending');

drop policy if exists "organizations_update_own_or_admin" on public.organizations;
create policy "organizations_update_own_or_admin" on public.organizations
  for update using (user_id = auth.uid() or public.is_admin());

-- food_listings: available listings are visible to any signed-in user;
-- suppliers always see their own; admins see all; orgs that requested a
-- listing can keep seeing it even after it's no longer "available".
drop policy if exists "listings_select_visible" on public.food_listings;
create policy "listings_select_visible" on public.food_listings
  for select to authenticated using (
    status = 'available'
    or supplier_id = auth.uid()
    or public.is_admin()
    or public.listing_has_org_request(food_listings.id)
  );

drop policy if exists "listings_insert_own" on public.food_listings;
create policy "listings_insert_own" on public.food_listings
  for insert with check (supplier_id = auth.uid());

-- update: only the supplier or an admin. Organization-driven state changes
-- happen through the guarded pickup functions above.
drop policy if exists "listings_update_own_or_admin" on public.food_listings;
create policy "listings_update_own_or_admin" on public.food_listings
  for update using (
    supplier_id = auth.uid()
    or public.is_admin()
  );

-- pickup_requests: only an APPROVED organization may create a request.
drop policy if exists "requests_insert_approved_org_only" on public.pickup_requests;
drop policy if exists "requests_insert_admin_only" on public.pickup_requests;
create policy "requests_insert_admin_only" on public.pickup_requests
  for insert with check (public.is_admin());

-- select: the requesting org, the listing's supplier, or an admin.
drop policy if exists "requests_select_participants_or_admin" on public.pickup_requests;
create policy "requests_select_participants_or_admin" on public.pickup_requests
  for select to authenticated using (
    exists (select 1 from public.organizations o where o.id = pickup_requests.organization_id and o.user_id = auth.uid())
    or public.listing_supplier_is_me(pickup_requests.listing_id)
    or public.is_admin()
  );

-- Direct request updates are admin-only. Participants use the guarded RPCs,
-- which limit each role to its own legal state transitions and timestamp.
drop policy if exists "requests_update_participants_or_admin" on public.pickup_requests;
create policy "requests_update_participants_or_admin" on public.pickup_requests
  for update to authenticated using (
    public.is_admin()
  ) with check (
    public.is_admin()
  );

-- notifications: users can read and insert their own notification log rows.
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications
  for select using (user_id = auth.uid() or public.is_admin());

drop policy if exists "notifications_insert_own" on public.notifications;
create policy "notifications_insert_own" on public.notifications
  for insert with check (user_id = auth.uid() or public.is_admin());

-- Prevent users from promoting themselves or approving their own
-- organization through the REST API. Admin-only changes use guarded RPCs.
revoke update on table public.users from authenticated;
grant update (name, phone, share_phone_on_accept) on table public.users to authenticated;
revoke update on table public.organizations from authenticated;
grant update (name, address, community_served, document_url) on table public.organizations to authenticated;

-- ---------------------------------------------------------------------------
-- Storage buckets + policies
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('food-photos', 'food-photos', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('org-documents', 'org-documents', false)
on conflict (id) do nothing;

drop policy if exists "food_photos_public_read" on storage.objects;
create policy "food_photos_public_read" on storage.objects
  for select using (bucket_id = 'food-photos');

drop policy if exists "food_photos_authenticated_upload" on storage.objects;
create policy "food_photos_authenticated_upload" on storage.objects
  for insert with check (bucket_id = 'food-photos' and auth.role() = 'authenticated');

drop policy if exists "org_documents_owner_read" on storage.objects;
create policy "org_documents_owner_read" on storage.objects
  for select using (
    bucket_id = 'org-documents'
    and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin())
  );

drop policy if exists "org_documents_owner_upload" on storage.objects;
create policy "org_documents_owner_upload" on storage.objects
  for insert with check (
    bucket_id = 'org-documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ---------------------------------------------------------------------------
-- Seed: 3 pre-verified organizations, so verification never blocks a demo.
--
-- Organizations reference a real auth user, so seed these AFTER creating
-- the matching accounts via /register-org.html (or the Supabase Auth
-- dashboard). Replace the emails below with the accounts you created, then
-- run just this last block.
-- ---------------------------------------------------------------------------

-- update public.organizations set verification_status = 'approved'
-- where user_id in (
--   select id from public.users where email in (
--     'demo-org-1@example.com',
--     'demo-org-2@example.com',
--     'demo-org-3@example.com'
--   )
-- );
