// js/listings.js
// Everything related to food_listings: creating, browsing, filtering.

import { supabase, STORAGE_BUCKET_LISTINGS } from "./supabase-client.js";

// Uploads a photo (optional) to Storage and inserts a new listing row.
// Status is "available" once safety is confirmed, otherwise saved as "draft".
export async function createListing(supplierId, fields, photoFile) {
  if (!fields.foodName || !fields.quantity || !fields.pickupDeadline || !fields.location) {
    throw new Error("Please complete every required field.");
  }
  if (!fields.safetyConfirmed) {
    throw new Error("Please confirm the food is safely stored before publishing.");
  }

  let photoUrl = null;
  if (photoFile && photoFile.size > 0) {
    const path = `${supplierId}/${Date.now()}-${photoFile.name}`;
    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET_LISTINGS).upload(path, photoFile, {
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) throw new Error(uploadError.message);
    const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET_LISTINGS).getPublicUrl(path);
    photoUrl = publicUrlData.publicUrl;
  }

  const { data, error } = await supabase
    .from("food_listings")
    .insert({
      supplier_id: supplierId,
      food_name: fields.foodName,
      food_type: fields.foodType || null,
      quantity: fields.quantity,
      prepared_at: fields.preparedAt || null,
      pickup_deadline: fields.pickupDeadline,
      location: fields.location,
      lat: fields.lat ?? null,
      lng: fields.lng ?? null,
      photo_url: photoUrl,
      safety_confirmed: true,
      status: "available",
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// Fetches all listings currently available for pickup, newest first.
export async function fetchAvailableListings({ location, minQuantity, deadlineBefore } = {}) {
  let query = supabase.from("food_listings").select("*").eq("status", "available").order("pickup_deadline", { ascending: true });

  if (location) query = query.ilike("location", `%${location}%`);
  if (deadlineBefore) query = query.lte("pickup_deadline", deadlineBefore);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  let results = data || [];
  if (minQuantity) {
    results = results.filter((row) => Number.parseFloat(row.quantity) >= Number.parseFloat(minQuantity) || Number.isNaN(Number.parseFloat(row.quantity)));
  }
  return results;
}

export async function fetchListingById(id) {
  const { data, error } = await supabase.from("food_listings").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchListingsForSupplier(supplierId) {
  const { data, error } = await supabase
    .from("food_listings")
    .select("*")
    .eq("supplier_id", supplierId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function updateListingStatus(id, status) {
  const { data, error } = await supabase.from("food_listings").update({ status }).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data;
}
