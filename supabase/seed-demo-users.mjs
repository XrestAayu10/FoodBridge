// supabase/seed-demo-users.mjs
//
// Creates one demo account for each role (admin, supplier, organization) plus
// a couple of sample food listings, using the Supabase Admin API. Admin-created
// users are auto-confirmed, so this sidesteps the "confirm your email" /
// email-rate-limit issues you hit when testing signup over and over.
//
// USAGE (run locally, never in a browser):
//   SUPABASE_URL="https://xxxx.supabase.co" \
//   SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
//   node supabase/seed-demo-users.mjs
//
// Find SUPABASE_SERVICE_ROLE_KEY in: Project Settings > Data API > service_role.
// This key bypasses Row Level Security — never put it in client-side code,
// never commit it, and only ever run this script from your own machine.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
  console.error('Run like: SUPABASE_URL="https://xxxx.supabase.co" SUPABASE_SERVICE_ROLE_KEY="..." node supabase/seed-demo-users.mjs');
  process.exit(1);
}

const authHeaders = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

async function createAuthUser({ email, password, name, role }) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role },
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    // If the user already exists, look it up instead of failing the whole run.
    if (data.msg?.includes("already been registered") || data.code === "email_exists") {
      console.log(`  ↳ ${email} already exists, looking it up…`);
      const listResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
        headers: authHeaders,
      });
      const listData = await listResponse.json();
      const existing = listData.users?.[0];
      if (!existing) throw new Error(`Could not find existing user ${email}`);
      return existing;
    }
    throw new Error(`Failed to create auth user ${email}: ${data.msg || response.statusText}`);
  }
  return data;
}

async function upsertRow(table, row) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
    method: "POST",
    headers: { ...authHeaders, Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Failed to upsert into ${table}: ${JSON.stringify(data)}`);
  return Array.isArray(data) ? data[0] : data;
}

async function insertRow(table, row) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...authHeaders, Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Failed to insert into ${table}: ${JSON.stringify(data)}`);
  return Array.isArray(data) ? data[0] : data;
}

async function main() {
  console.log("Creating demo admin…");
  const adminAuth = await createAuthUser({ email: "admin@foodbridge.demo", password: "Demo1234!", name: "FoodBridge Admin", role: "admin" });
  await upsertRow("users", { id: adminAuth.id, name: "FoodBridge Admin", email: "admin@foodbridge.demo", role: "admin", status: "active" });

  console.log("Creating demo supplier…");
  const supplierAuth = await createAuthUser({ email: "supplier@foodbridge.demo", password: "Demo1234!", name: "Himalayan Catering", role: "supplier" });
  await upsertRow("users", { id: supplierAuth.id, name: "Himalayan Catering", email: "supplier@foodbridge.demo", phone: "+977-9800000001", share_phone_on_accept: true, role: "supplier", status: "active" });

  console.log("Creating demo organization…");
  const orgAuth = await createAuthUser({ email: "org@foodbridge.demo", password: "Demo1234!", name: "Hope Relief Nepal", role: "organization" });
  await upsertRow("users", { id: orgAuth.id, name: "Hope Relief Nepal", email: "org@foodbridge.demo", phone: "+977-9800000002", share_phone_on_accept: true, role: "organization", status: "active" });

  // Organizations table has its own id, so check for an existing row first.
  const existingOrgResponse = await fetch(`${SUPABASE_URL}/rest/v1/organizations?user_id=eq.${orgAuth.id}&select=id`, { headers: authHeaders });
  const existingOrgRows = await existingOrgResponse.json();
  let organizationId = existingOrgRows?.[0]?.id;
  if (!organizationId) {
    const org = await insertRow("organizations", {
      user_id: orgAuth.id,
      name: "Hope Relief Nepal",
      address: "Patan, Lalitpur",
      community_served: "Displaced families in the Kathmandu valley",
      verification_status: "approved",
    });
    organizationId = org.id;
  } else {
    await fetch(`${SUPABASE_URL}/rest/v1/organizations?id=eq.${organizationId}`, {
      method: "PATCH",
      headers: { ...authHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ verification_status: "approved" }),
    });
  }

  console.log("Creating sample food listings for the demo supplier…");
  const now = Date.now();
  const listings = [
    { food_name: "50 Veg Meal Boxes", food_type: "Cooked meals", quantity: "50 portions", location: "Thamel, Kathmandu", pickup_deadline: new Date(now + 4 * 60 * 60 * 1000).toISOString() },
    { food_name: "30 Bread Packs", food_type: "Bakery", quantity: "30 packs", location: "Lazimpat, Kathmandu", pickup_deadline: new Date(now + 6 * 60 * 60 * 1000).toISOString() },
  ];
  for (const listing of listings) {
    await insertRow("food_listings", {
      supplier_id: supplierAuth.id,
      ...listing,
      safety_confirmed: true,
      status: "available",
    });
  }

  console.log("\nDone! Demo accounts (password for all: Demo1234!):");
  console.log("  Admin:        admin@foodbridge.demo");
  console.log("  Supplier:     supplier@foodbridge.demo");
  console.log("  Organization: org@foodbridge.demo  (pre-approved)");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
