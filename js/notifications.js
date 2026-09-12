// js/notifications.js
// EmailJS notifications + a log row in the `notifications` table.
//
// SETUP: create a free account at https://www.emailjs.com, then paste your
// service id, template ids, and public key below.

import { supabase } from "./supabase-client.js";

const EMAILJS_PUBLIC_KEY = "tkq2lgY_YDXFUyiOG"; // TODO: replace
// EmailJS supports this reserved id for the service marked Default in the
// dashboard. It avoids failures caused by copying an id from another account.
const EMAILJS_SERVICE_ID = "default_service";
const EMAILJS_TEMPLATES = {
  requestCreated: "template_request_created", // TODO: replace with your template id
  requestAccepted: "template_9kx2jim", // TODO: replace with your template id
  pickupCompleted: "template_63zfaze", // TODO: replace with your template id
  deadlineReminder: "template_deadline_reminder", // TODO: replace with your template id
};

const EMAILJS_TEMPLATE_PLACEHOLDERS = new Set([
  "template_request_created",
  "template_request_accepted",
  "template_pickup_completed",
  "template_deadline_reminder",
]);

function isEmailCoreConfigured() {
  return Boolean(
    EMAILJS_PUBLIC_KEY &&
    EMAILJS_SERVICE_ID &&
    !EMAILJS_PUBLIC_KEY.startsWith("YOUR-") &&
    !EMAILJS_SERVICE_ID.startsWith("YOUR-")
  );
}

function isTemplateConfigured(templateId) {
  return Boolean(templateId && !templateId.startsWith("YOUR-") && !EMAILJS_TEMPLATE_PLACEHOLDERS.has(templateId));
}

export function isEmailConfigured(templateKeys = Object.keys(EMAILJS_TEMPLATES)) {
  const keys = Array.isArray(templateKeys) ? templateKeys : [templateKeys];
  return isEmailCoreConfigured() && keys.every(
    (key) => Object.hasOwn(EMAILJS_TEMPLATES, key) && isTemplateConfigured(EMAILJS_TEMPLATES[key])
  );
}

let emailjsReady = null;
const EMAIL_SEND_GAP_MS = 1100;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Lazily loads the EmailJS SDK from CDN so pages that never send email
// don't pay the cost of loading it.
async function loadEmailJs() {
  if (!isEmailCoreConfigured()) {
    throw new Error("EmailJS account and service are not configured yet.");
  }
  if (emailjsReady) return emailjsReady;
  emailjsReady = new Promise((resolve, reject) => {
    if (window.emailjs) {
      window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
      resolve(window.emailjs);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
    script.onload = () => {
      window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
      resolve(window.emailjs);
    };
    script.onerror = () => reject(new Error("Could not load EmailJS."));
    document.head.appendChild(script);
  });
  return emailjsReady;
}

// Sends an email via EmailJS and best-effort logs it to `notifications`.
// Failures are swallowed (logged to console) so email issues never block
// the core pickup workflow.
export async function sendNotification({ userId, type, templateId, templateParams }) {
  let delivered = false;
  try {
    if (!isTemplateConfigured(templateId)) {
      throw new Error(`EmailJS template for "${type}" is not configured yet.`);
    }
    const recipientEmail = String(templateParams?.to_email || templateParams?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      throw new Error(`A valid recipient email is missing for "${type}".`);
    }
    // Support both the FoodBridge variables and EmailJS's default Contact Us
    // template, whose To/Reply-To fields commonly reference `email`.
    const partnerEmail = String(templateParams?.partner_email || "").trim().toLowerCase();
    const replyTo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partnerEmail) ? partnerEmail : recipientEmail;
    const normalizedParams = {
      ...templateParams,
      to_email: recipientEmail,
      email: recipientEmail,
      reply_to: replyTo,
      partner_email: partnerEmail || "Not shared",
      name: templateParams?.recipient_name || templateParams?.organization_name || templateParams?.supplier_name || "FoodBridge",
    };
    const emailjs = await loadEmailJs();
    await emailjs.send(EMAILJS_SERVICE_ID, templateId, normalizedParams);
    delivered = true;
  } catch (error) {
    console.error(`EmailJS notification "${type}" failed`, error);
  }

  // `sent_at` means EmailJS accepted the message; failed attempts are not
  // recorded as delivered notifications.
  if (delivered && userId) {
    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      type,
      channel: "email",
      sent_at: new Date().toISOString(),
    });
    if (error) console.error("Failed to log notification", error);
  }
  return delivered;
}

export function notifyRequestCreated({ supplierId, supplierEmail, organizationName, foodName }) {
  return sendNotification({
    userId: supplierId,
    type: "request_created",
    templateId: EMAILJS_TEMPLATES.requestCreated,
    templateParams: { to_email: supplierEmail, organization_name: organizationName, food_name: foodName },
  });
}

export function notifyRequestAccepted({ organizationUserId, organizationEmail, foodName, pickupCode }) {
  return sendNotification({
    userId: organizationUserId,
    type: "request_accepted",
    templateId: EMAILJS_TEMPLATES.requestAccepted,
    templateParams: { to_email: organizationEmail, food_name: foodName, pickup_code: pickupCode },
  });
}

export async function notifyPickupAcceptedBoth({ contacts, listing, pickupCode }) {
  if (!contacts) return { organization: false, supplier: false, allDelivered: false };
  const shared = {
    food_name: listing?.food_name || "Food pickup",
    quantity: listing?.quantity || "",
    pickup_location: listing?.location || "",
    pickup_deadline: listing?.pickup_deadline || "",
    supplier_name: contacts.supplier_name,
    organization_name: contacts.organization_name,
  };
  const organization = await sendNotification({
      userId: contacts.organization_user_id,
      type: "request_accepted",
      templateId: EMAILJS_TEMPLATES.requestAccepted,
      templateParams: {
        ...shared,
        to_email: contacts.organization_email,
        recipient_name: contacts.organization_name,
        recipient_role: "Organization",
        partner_name: contacts.supplier_name,
        partner_email: contacts.supplier_email,
        pickup_code: pickupCode,
        partner_phone: contacts.supplier_phone || "Not shared",
      },
    });
  await wait(EMAIL_SEND_GAP_MS);
  const supplier = await sendNotification({
      userId: contacts.supplier_user_id,
      type: "request_accepted",
      templateId: EMAILJS_TEMPLATES.requestAccepted,
      templateParams: {
        ...shared,
        to_email: contacts.supplier_email,
        recipient_name: contacts.supplier_name,
        recipient_role: "Supplier",
        partner_name: contacts.organization_name,
        partner_email: contacts.organization_email,
        pickup_code: "Shown only to the organization",
        partner_phone: contacts.organization_phone || "Not shared",
      },
    });
  return { organization, supplier, allDelivered: organization && supplier };
}

export async function notifyPickupCompletedBoth({ contacts, listing, reference, completedAt }) {
  if (!contacts) return { supplier: false, organization: false, allDelivered: false };
  const shared = {
    food_name: listing?.food_name || "Food pickup",
    quantity: listing?.quantity || "",
    pickup_location: listing?.location || "",
    supplier_name: contacts.supplier_name,
    organization_name: contacts.organization_name,
    pickup_reference: reference,
    completed_at: completedAt,
    status: "Collected",
  };
  const supplier = await sendNotification({
    userId: contacts.supplier_user_id,
    type: "pickup_completed",
    templateId: EMAILJS_TEMPLATES.pickupCompleted,
    templateParams: {
      ...shared,
      to_email: contacts.supplier_email,
      recipient_name: contacts.supplier_name,
      recipient_role: "Supplier",
      partner_name: contacts.organization_name,
      partner_email: contacts.organization_email,
      partner_phone: contacts.organization_phone || "Not shared",
    },
  });
  await wait(EMAIL_SEND_GAP_MS);
  const organization = await sendNotification({
    userId: contacts.organization_user_id,
    type: "pickup_completed",
    templateId: EMAILJS_TEMPLATES.pickupCompleted,
    templateParams: {
      ...shared,
      to_email: contacts.organization_email,
      recipient_name: contacts.organization_name,
      recipient_role: "Organization",
      partner_name: contacts.supplier_name,
      partner_email: contacts.supplier_email,
      partner_phone: contacts.supplier_phone || "Not shared",
    },
  });
  return { supplier, organization, allDelivered: supplier && organization };
}

export function notifyDeadlineReminder({ userId, toEmail, foodName, deadline }) {
  return sendNotification({
    userId,
    type: "deadline_reminder",
    templateId: EMAILJS_TEMPLATES.deadlineReminder,
    templateParams: { to_email: toEmail, food_name: foodName, deadline },
  });
}

// Best-effort, client-side-only reminder: while a supplier/org has a page
// open, check every minute for listings within 1 hour of their deadline and
// fire a reminder once per listing per browser session. A real production
// setup should replace this with a scheduled Supabase Edge Function, since
// this only runs while someone has the app open in a tab.
const remindedIds = new Set();
export function watchDeadlineReminders(listings, { userId, toEmail } = {}) {
  const check = () => {
    const now = Date.now();
    for (const listing of listings) {
      if (remindedIds.has(listing.id)) continue;
      const deadline = new Date(listing.pickup_deadline).getTime();
      const diffMinutes = (deadline - now) / 60000;
      if (diffMinutes > 0 && diffMinutes <= 60) {
        remindedIds.add(listing.id);
        notifyDeadlineReminder({ userId, toEmail, foodName: listing.food_name, deadline: listing.pickup_deadline });
      }
    }
  };
  check();
  return setInterval(check, 60000);
}
