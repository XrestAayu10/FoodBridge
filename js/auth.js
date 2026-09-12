// js/auth.js
// Registration + login for suppliers, organizations, and admins.

import { supabase } from "./supabase-client.js";

const PENDING_PROFILE_KEY = "foodbridge_pending_profile";

function savePendingProfile(email, profile) {
  sessionStorage.setItem(PENDING_PROFILE_KEY, JSON.stringify({ email, ...profile }));
}

function loadPendingProfile(email) {
  const raw = sessionStorage.getItem(PENDING_PROFILE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.email === email ? parsed : null;
  } catch {
    return null;
  }
}

function clearPendingProfile() {
  sessionStorage.removeItem(PENDING_PROFILE_KEY);
}

// Inserts the `users` row (and `organizations` row for org accounts). Only
// safe to call once there's an authenticated session, since RLS requires
// auth.uid() = id.
async function createProfileRows(user, { name, email, phone, sharePhoneOnAccept, role, org }) {
  const { error: profileError } = await supabase.from("users").insert({
    id: user.id,
    name,
    email,
    phone: phone || null,
    share_phone_on_accept: Boolean(sharePhoneOnAccept),
    role,
    status: "active",
  });
  if (profileError) throw new Error(profileError.message);

  if (role === "organization") {
    const { error: orgError } = await supabase.from("organizations").insert({
      user_id: user.id,
      name: org?.name || name,
      address: org?.address || null,
      community_served: org?.communityServed || null,
      document_url: org?.documentUrl || null,
      verification_status: "pending",
    });
    if (orgError) throw new Error(orgError.message);
  }
}

// Creates the auth user, then a matching row in `users` (and `organizations`
// for org accounts). Throws with a friendly message on failure.
export async function registerUser({ name, email, phone, sharePhoneOnAccept, password, role, org }) {
  const cleanEmail = (email || "").trim().toLowerCase();
  const cleanName = (name || "").trim();
  if (!cleanName || !cleanEmail || !password || !role) {
    throw new Error("Please complete every required field.");
  }
  if (sharePhoneOnAccept && !(phone || "").trim()) {
    throw new Error("Add a phone number before enabling contact sharing.");
  }

  const profileFields = { name: cleanName, email: cleanEmail, phone: phone ? phone.trim() : null, sharePhoneOnAccept: Boolean(sharePhoneOnAccept), role, org };
  // Saved BEFORE signUp so the profile can still be created later (on first
  // login) if this project requires email confirmation and there's no
  // session yet to satisfy the `users_insert_own` RLS policy.
  savePendingProfile(cleanEmail, profileFields);

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: cleanEmail,
    password,
    options: { data: { name: cleanName, role } },
  });
  if (signUpError) throw new Error(signUpError.message);

  const user = signUpData.user;
  if (!user) {
    throw new Error("Check your inbox to confirm your email, then log in.");
  }

  // No session yet (email confirmation required) — auth.uid() would be null,
  // so inserting the profile now would fail RLS. Defer it to first login.
  if (!signUpData.session) {
    throw new Error("Check your inbox to confirm your email, then log in.");
  }

  await createProfileRows(user, profileFields);
  clearPendingProfile();

  return user;
}

export async function updateContactSharing({ userId, phone, sharePhoneOnAccept }) {
  const cleanPhone = (phone || "").trim();
  if (sharePhoneOnAccept && !cleanPhone) {
    throw new Error("Add a phone number before enabling contact sharing.");
  }
  const { data, error } = await supabase
    .from("users")
    .update({ phone: cleanPhone || null, share_phone_on_accept: Boolean(sharePhoneOnAccept) })
    .eq("id", userId)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function loginUser({ email, password }) {
  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail || !password) throw new Error("Enter your email and password.");
  const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
  if (error) throw new Error(error.message);

  // First login after email confirmation: the `users` row may not exist yet
  // because registerUser couldn't write it without a session. Create it now.
  const { data: existingProfile } = await supabase.from("users").select("id").eq("id", data.user.id).maybeSingle();
  if (!existingProfile) {
    const pending = loadPendingProfile(cleanEmail);
    if (pending) {
      await createProfileRows(data.user, pending);
      clearPendingProfile();
    }
  }

  return data.user;
}

export async function logoutUser() {
  await supabase.auth.signOut();
}

// Looks up the organization row (with verification status) for a user id.
export async function fetchOrganizationForUser(userId) {
  const { data, error } = await supabase.from("organizations").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
