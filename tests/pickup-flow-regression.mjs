import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [schema, migration, requests, notifications, supplierPage, orgPage, adminPage, auth] = await Promise.all([
  read("supabase/schema.sql"),
  read("supabase/add-pickup-communication.sql"),
  read("js/requests.js"),
  read("js/notifications.js"),
  read("supplier/requests.html"),
  read("org/my-requests.html"),
  read("admin/verification-queue.html"),
  read("js/auth.js"),
]);

for (const sql of [schema, migration]) {
  assert.match(sql, /create or replace function public\.create_pickup_request/);
  assert.match(sql, /create or replace function public\.accept_pickup_request/);
  assert.doesNotMatch(sql, /gen_random_bytes/, "pickup code generation must not depend on the pgcrypto schema path");
  assert.match(sql, /lpad\(floor\(random\(\) \* 1000000\)/);
  assert.match(sql, /create or replace function public\.reject_pickup_request/);
  assert.match(sql, /create or replace function public\.confirm_pickup_collection/);
  assert.match(sql, /for update;/i, "state transition must lock its row");
  assert.match(sql, /share_phone_on_accept/);
  assert.match(sql, /pr\.status in \('accepted', 'collected'\).*share_phone_on_accept/);
  assert.match(sql, /requests_insert_admin_only/);
  assert.match(sql, /set_organization_verification/);
}

const usersTablePosition = schema.indexOf("create table if not exists public.users");
const compatibilityAlterPosition = schema.indexOf("alter table public.users\n  add column if not exists share_phone_on_accept");
const contactsFunctionPosition = schema.indexOf("create or replace function public.get_pickup_contacts");
assert.ok(usersTablePosition >= 0 && compatibilityAlterPosition > usersTablePosition);
assert.ok(contactsFunctionPosition > compatibilityAlterPosition, "existing databases must add the consent column before contact functions are created");

assert.match(requests, /rpc\("create_pickup_request"/);
assert.match(requests, /rpc\("accept_pickup_request"/);
assert.match(requests, /rpc\("reject_pickup_request"/);
assert.match(requests, /rpc\("confirm_pickup_collection"/);
assert.doesNotMatch(requests, /from\("pickup_requests"\)\.update/);

assert.match(supplierPage, /Enter the code shown by the organization/);
assert.doesNotMatch(supplierPage, /Pickup code: <span/);
assert.match(orgPage, /Pickup code: <span/);
assert.match(orgPage, /Confirm food received/);
assert.match(adminPage, /rpc\("set_organization_verification"/);

assert.match(notifications, /notifyPickupAcceptedBoth/);
assert.match(notifications, /notifyPickupCompletedBoth/);
assert.match(notifications, /isEmailConfigured/);
assert.match(notifications, /templateKeys = Object\.keys\(EMAILJS_TEMPLATES\)/);
assert.match(notifications, /EMAIL_SEND_GAP_MS = 1100/);
assert.match(notifications, /recipientEmail/);
assert.match(notifications, /reply_to: replyTo/);
assert.match(notifications, /partner_email/);
assert.match(notifications, /recipient_name/);
assert.match(notifications, /EMAILJS_TEMPLATE_PLACEHOLDERS/);
assert.match(notifications, /isTemplateConfigured\(templateId\)/);
assert.match(notifications, /allDelivered/);
assert.match(notifications, /partner_phone/);
assert.match(notifications, /delivered && userId/);
assert.match(auth, /updateContactSharing/);

console.log("Pickup flow regression checks passed.");
