// js/requests.js
// pickup_requests workflow: create, accept/reject, code-confirm collection.

import { supabase } from "./supabase-client.js";
import { notifyRequestCreated, notifyPickupAcceptedBoth, notifyPickupCompletedBoth } from "./notifications.js";

function oneRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

export async function fetchPickupContacts(requestId) {
  const { data, error } = await supabase.rpc("get_pickup_contacts", { p_request_id: requestId });
  if (error) throw new Error(error.message);
  return data?.[0] || null;
}

async function attachContacts(requests) {
  return Promise.all((requests || []).map(async (request) => {
    if (!['accepted', 'collected'].includes(request.status)) return request;
    try {
      return { ...request, contacts: await fetchPickupContacts(request.id) };
    } catch {
      return request;
    }
  }));
}

// Organization requests a pickup on an available listing.
export async function createPickupRequest({ listing, organizationId, requestedQuantity }) {
  const { data, error } = await supabase.rpc("create_pickup_request", {
    p_listing_id: listing.id,
    p_organization_id: organizationId,
    p_requested_quantity: requestedQuantity || listing.quantity,
  });
  if (error) throw new Error(error.message);

  // Best-effort email to the supplier; failures never block the request.
  try {
    const contacts = await fetchPickupContacts(oneRow(data).id);
    if (contacts) {
      void notifyRequestCreated({
        supplierId: contacts.supplier_user_id,
        supplierEmail: contacts.supplier_email,
        organizationName: contacts.organization_name || "A relief organization",
        foodName: listing.food_name,
      });
    }
  } catch (notificationError) {
    console.error("Could not prepare new-request notification", notificationError);
  }

  return oneRow(data);
}

// Requests for listings owned by this supplier, with listing + org info joined in.
export async function fetchRequestsForSupplier(supplierId) {
  const { data, error } = await supabase
    .from("pickup_requests")
    .select("*, food_listings!inner(id, food_name, quantity, pickup_deadline, location, supplier_id), organizations(name)")
    .eq("food_listings.supplier_id", supplierId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return attachContacts(data || []);
}

// Requests made by this organization.
export async function fetchRequestsForOrganization(organizationId) {
  const { data, error } = await supabase
    .from("pickup_requests")
    .select("*, food_listings(id, food_name, quantity, pickup_deadline, location, photo_url)")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return attachContacts(data || []);
}

// Supplier accepts a request: generates a pickup code and reserves the listing.
export async function acceptRequest(request) {
  const { data, error } = await supabase.rpc("accept_pickup_request", { p_request_id: request.id });
  if (error) throw new Error(error.message);
  const acceptedRequest = oneRow(data);

  try {
    const contacts = await fetchPickupContacts(request.id);
    acceptedRequest.emailDelivery = await notifyPickupAcceptedBoth({ contacts, listing: request.food_listings, pickupCode: acceptedRequest.pickup_code });
  } catch (notificationError) {
    console.error("Could not prepare accepted-pickup notifications", notificationError);
    acceptedRequest.emailDelivery = { organization: false, supplier: false, allDelivered: false };
  }

  return acceptedRequest;
}

// Supplier rejects a request: listing goes back to available.
export async function rejectRequest(request) {
  const { data, error } = await supabase.rpc("reject_pickup_request", { p_request_id: request.id });
  if (error) throw new Error(error.message);
  return oneRow(data);
}

// The supplier enters the code shown by the organization; the organization
// independently confirms receipt. The database marks it collected only once
// both sides have confirmed.
export async function confirmCollection(request, enteredCode, role) {
  if (!['supplier', 'organization'].includes(role)) throw new Error("Unknown pickup role.");
  const wasCollected = request.status === "collected";
  const { data, error } = await supabase.rpc("confirm_pickup_collection", {
    p_request_id: request.id,
    p_pickup_code: role === "supplier" ? String(enteredCode || "") : null,
  });
  if (error) throw new Error(error.message);
  const confirmedRequest = oneRow(data);

  if (!wasCollected && confirmedRequest.status === "collected") {
    const now = new Date().toISOString();
    try {
      const contacts = await fetchPickupContacts(request.id);
      confirmedRequest.emailDelivery = await notifyPickupCompletedBoth({ contacts, listing: request.food_listings, reference: request.id, completedAt: now });
    } catch (notificationError) {
      console.error("Could not prepare pickup receipt notifications", notificationError);
      confirmedRequest.emailDelivery = { supplier: false, organization: false, allDelivered: false };
    }
  }

  return confirmedRequest;
}

// Impact stats used on supplier/org/admin impact dashboards.
export async function fetchImpactStats() {
  const [{ count: mealsRescued }, { count: activeListings }, { count: verifiedOrgs }, { data: collectedRequests }] = await Promise.all([
    supabase.from("pickup_requests").select("id", { count: "exact", head: true }).eq("status", "collected"),
    supabase.from("food_listings").select("id", { count: "exact", head: true }).eq("status", "available"),
    supabase.from("organizations").select("id", { count: "exact", head: true }).eq("verification_status", "approved"),
    supabase.from("pickup_requests").select("created_at, supplier_confirmed_at, organization_confirmed_at").eq("status", "collected"),
  ]);

  let avgMinutes = null;
  if (collectedRequests && collectedRequests.length > 0) {
    const durations = collectedRequests
      .map((r) => {
        const end = r.organization_confirmed_at || r.supplier_confirmed_at;
        if (!end) return null;
        return (new Date(end).getTime() - new Date(r.created_at).getTime()) / 60000;
      })
      .filter((v) => v !== null && v >= 0);
    if (durations.length > 0) {
      avgMinutes = Math.round(durations.reduce((sum, v) => sum + v, 0) / durations.length);
    }
  }

  return {
    mealsRescued: mealsRescued || 0,
    activeListings: activeListings || 0,
    verifiedOrgs: verifiedOrgs || 0,
    avgTimeToPickupMinutes: avgMinutes,
  };
}
