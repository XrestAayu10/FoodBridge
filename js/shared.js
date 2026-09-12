// js/shared.js
// Injects the shared header + footer into every page, and exposes small
// UI helpers (toasts, empty/loading/error states, badges, formatting)
// so markup is never duplicated across pages.

import { supabase } from "./supabase-client.js";
export { generatePickupCode } from "./pickup-code.js";

/* ---------------------------------------------------------------------- */
/* Path helpers                                                           */
/* ---------------------------------------------------------------------- */

// Depth-aware relative prefix so nav links work whether the page lives at
// the site root ("/index.html") or one folder deep ("/supplier/dashboard.html").
function rootPrefix() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  // segments.length includes the file itself; folders = segments.length - 1
  const depth = Math.max(segments.length - 1, 0);
  return depth === 0 ? "" : "../".repeat(depth);
}

function isActive(href) {
  return window.location.pathname.endsWith(href);
}

/* ---------------------------------------------------------------------- */
/* Header / Nav / Footer                                                  */
/* ---------------------------------------------------------------------- */

const NAV_BY_ROLE = {
  guest: [
    ["index.html", "Home"],
    ["how-it-works.html", "How it works"],
  ],
  supplier: [
    ["supplier/dashboard.html", "Dashboard"],
    ["supplier/post-food.html", "Post food"],
    ["supplier/listings.html", "My listings"],
    ["supplier/requests.html", "Requests"],
    ["supplier/impact.html", "Impact"],
  ],
  organization: [
    ["org/browse.html", "Browse food"],
    ["org/my-requests.html", "My requests"],
    ["org/profile.html", "Profile"],
  ],
  admin: [
    ["admin/dashboard.html", "Dashboard"],
    ["admin/verification-queue.html", "Verification"],
    ["admin/impact.html", "Impact"],
  ],
};

function buildNavLinks(role, prefix) {
  const links = NAV_BY_ROLE[role] || NAV_BY_ROLE.guest;
  return links
    .map(([href, label]) => {
      const activeClass = isActive(href) ? " active" : "";
      return `<a class="${activeClass.trim()}" href="${prefix}${href}">${label}</a>`;
    })
    .join("");
}

async function renderHeader(profile) {
  const prefix = rootPrefix();
  const header = document.getElementById("site-header");
  if (!header) return;

  let rightSide = "";
  if (profile) {
    rightSide = `
      <span class="role-badge">${escapeHtml(profile.role)}</span>
      <button class="btn btn-secondary btn-sm" id="logout-button" type="button">Log out</button>
    `;
  } else {
    rightSide = `
      <a class="btn btn-secondary btn-sm" href="${prefix}login.html">Log in</a>
      <a class="btn btn-primary btn-sm" href="${prefix}register-supplier.html">Register</a>
    `;
  }

  const role = profile ? profile.role : "guest";

  header.innerHTML = `
    <div class="container">
      <a class="brand" href="${prefix}index.html">Aahar<span>Link</span></a>
      <button class="nav-toggle" id="nav-toggle" type="button" aria-label="Open menu" aria-expanded="false">☰</button>
      <nav class="site-nav" id="site-nav" aria-label="Main navigation">
        ${buildNavLinks(role, prefix)}
      </nav>
      <div class="flex gap-sm" style="margin-left:12px; align-items:center;">
        ${rightSide}
      </div>
    </div>
  `;

  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  const logoutButton = document.getElementById("logout-button");
  if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
      await supabase.auth.signOut();
      window.location.href = `${prefix}index.html`;
    });
  }
}

function renderFooter() {
  const footer = document.getElementById("site-footer");
  if (!footer) return;
  const prefix = rootPrefix();
  footer.innerHTML = `
    <div class="container">
      <span>&copy; ${new Date().getFullYear()} AaharLink · Food rescue for Nepal</span>
      <span><a href="${prefix}how-it-works.html">How it works</a></span>
    </div>
  `;
}

/* ---------------------------------------------------------------------- */
/* Current user / profile                                                 */
/* ---------------------------------------------------------------------- */

let cachedProfile = null;
let cachedProfilePromise = null;

// Fetches the signed-in user's row from `users` (role, status, name, ...).
// Returns null when signed out. Cached for the lifetime of the page.
export async function getCurrentProfile({ fresh = false } = {}) {
  if (!fresh && cachedProfilePromise) return cachedProfilePromise;

  cachedProfilePromise = (async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    if (!session) {
      cachedProfile = null;
      return null;
    }
    const { data, error } = await supabase.from("users").select("*").eq("id", session.user.id).maybeSingle();
    if (error) {
      console.error("Failed to load profile", error);
      cachedProfile = null;
      return null;
    }
    cachedProfile = data;
    return data;
  })();

  return cachedProfilePromise;
}

// Call at the top of a protected page. Redirects to login (or to the
// correct dashboard) if the signed-in user doesn't have the right role.
export async function requireRole(allowedRoles) {
  const prefix = rootPrefix();
  const profile = await getCurrentProfile();
  if (!profile) {
    window.location.href = `${prefix}login.html`;
    return null;
  }
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  if (!roles.includes(profile.role)) {
    const home = { supplier: "supplier/dashboard.html", organization: "org/browse.html", admin: "admin/dashboard.html" };
    window.location.href = `${prefix}${home[profile.role] || "index.html"}`;
    return null;
  }
  return profile;
}

/* ---------------------------------------------------------------------- */
/* Toasts                                                                  */
/* ---------------------------------------------------------------------- */

let toastTimer = null;
export function showToast(message, type = "default") {
  let toast = document.getElementById("app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    toast.className = "toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.className = `toast show${type === "error" ? " toast-error" : ""}${type === "success" ? " toast-success" : ""}`;
  toast.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

/* ---------------------------------------------------------------------- */
/* Empty / loading / error state renderers                                */
/* ---------------------------------------------------------------------- */

export function renderLoading(container, message = "Loading…") {
  if (!container) return;
  container.innerHTML = `
    <div class="state-panel" role="status">
      <div class="spinner"></div>
      <p class="mb-0">${escapeHtml(message)}</p>
    </div>
  `;
}

export function renderEmpty(container, { icon = "🍽️", title = "Nothing here yet", message = "" } = {}) {
  if (!container) return;
  container.innerHTML = `
    <div class="state-panel">
      <div class="state-icon">${icon}</div>
      <h3>${escapeHtml(title)}</h3>
      ${message ? `<p class="mb-0">${escapeHtml(message)}</p>` : ""}
    </div>
  `;
}

export function renderError(container, { title = "Something went wrong", message = "Please try again." } = {}, onRetry) {
  if (!container) return;
  container.innerHTML = `
    <div class="state-panel state-error">
      <div class="state-icon">⚠️</div>
      <h3>${escapeHtml(title)}</h3>
      <p class="mb-0">${escapeHtml(message)}</p>
      ${onRetry ? '<button class="btn btn-secondary btn-sm mt-md" id="state-retry-button" type="button">Try again</button>' : ""}
    </div>
  `;
  if (onRetry) {
    document.getElementById("state-retry-button")?.addEventListener("click", onRetry);
  }
}

/* ---------------------------------------------------------------------- */
/* Formatting helpers                                                     */
/* ---------------------------------------------------------------------- */

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Returns a short human string like "45 min left" or "Deadline passed".
export function timeUntil(iso) {
  if (!iso) return "";
  const diffMs = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(diffMs)) return "";
  if (diffMs <= 0) return "Deadline passed";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr left`;
  return `${Math.round(hours / 24)} day(s) left`;
}

export function isExpiringSoon(iso, thresholdMinutes = 60) {
  if (!iso) return false;
  const diffMs = new Date(iso).getTime() - Date.now();
  return diffMs > 0 && diffMs <= thresholdMinutes * 60000;
}

const BADGE_LABELS = {
  available: "Available",
  requested: "Requested",
  reserved: "Reserved",
  collected: "Collected",
  draft: "Draft",
  closed: "Closed",
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
  approved: "Approved",
};

// Renders a pill-shaped, color-coded status badge. Pass expiring:true to
// force the pulsing red "expiring soon" style regardless of status.
export function statusBadgeHtml(status, { expiring = false } = {}) {
  const key = expiring ? "expiring" : status;
  const label = expiring ? "Expiring soon" : BADGE_LABELS[status] || status;
  return `<span class="badge badge-${key}"><span class="badge-dot"></span>${escapeHtml(label)}</span>`;
}

/* ---------------------------------------------------------------------- */
/* Boot                                                                    */
/* ---------------------------------------------------------------------- */

async function init() {
  renderFooter();
  const profile = await getCurrentProfile();
  await renderHeader(profile);

  supabase.auth.onAuthStateChange(async (_event, _session) => {
    const fresh = await getCurrentProfile({ fresh: true });
    renderHeader(fresh);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
