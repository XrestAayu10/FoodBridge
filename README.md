# FoodBridge

A beginner-friendly, multi-page food-rescue platform connecting surplus-food suppliers with verified relief organizations in Nepal. Built with **plain HTML, CSS, and vanilla JavaScript (ES modules)** — no frameworks, no bundlers, no build step. Data, auth, and file storage run entirely on [Supabase](https://supabase.com); email notifications run on [EmailJS](https://www.emailjs.com). Because there's no backend server, it deploys anywhere static files are served (Netlify, Vercel, GitHub Pages, etc.).

For the current accepted/completed email templates, follow [EMAILJS_SETUP.md](EMAILJS_SETUP.md).

## File structure

```
index.html                     landing page
how-it-works.html
login.html
register-supplier.html
register-org.html
supplier/dashboard.html
supplier/post-food.html
supplier/listings.html
supplier/requests.html
supplier/impact.html
org/browse.html
org/listing-detail.html
org/my-requests.html
org/profile.html
admin/dashboard.html
admin/verification-queue.html
admin/impact.html
js/supabase-client.js          Supabase client init
js/shared.js                   header/nav/footer injection + UI helpers
js/auth.js                     register/login
js/listings.js                 food_listings CRUD + photo upload
js/requests.js                 pickup_requests workflow + impact stats
js/notifications.js            EmailJS notifications
css/styles.css                 the one shared stylesheet
supabase/schema.sql             tables, RLS policies, storage buckets
supabase/add-pickup-communication.sql  migration for an existing database
supabase/seed-demo-users.mjs    optional script to create demo accounts + sample listings
```

The header, navigation, and footer are never duplicated in markup — every page has empty `<header id="site-header">` / `<footer id="site-footer">` placeholders that `js/shared.js` fills in based on the signed-in user's role.

## Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com).
2. Open the **SQL editor** and run all of [supabase/schema.sql](supabase/schema.sql). This creates the `users`, `organizations`, `food_listings`, `pickup_requests`, and `notifications` tables, their Row Level Security policies, and the `food-photos` / `org-documents` storage buckets.
3. In **Project settings → API**, copy your **Project URL** and **anon public key** into [js/supabase-client.js](js/supabase-client.js) (`SUPABASE_URL`, `SUPABASE_ANON_KEY`).
4. **Create a free EmailJS account**, connect an email service and mark it as the Default service, then add four templates (request created, request accepted, pickup completed, deadline reminder). Paste the template ids and public key into [js/notifications.js](js/notifications.js); the code uses EmailJS's reserved `default_service` id. The accepted/completed templates can use: `to_email`, `food_name`, `quantity`, `pickup_location`, `pickup_deadline`, `supplier_name`, `organization_name`, `pickup_code`, `partner_phone`, `pickup_reference`, and `completed_at`.
5. **(Recommended) Seed demo accounts** instead of registering by hand — this avoids Supabase's email-confirmation and email-rate-limit hiccups entirely, since admin-created users are auto-confirmed:

   ```bash
   SUPABASE_URL="https://YOUR-PROJECT-REF.supabase.co" \
   SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
   node supabase/seed-demo-users.mjs
   ```

   Find the `service_role` key under **Project Settings → Data API**. This key bypasses Row Level Security — only ever use it locally in this script, never in browser code or committed files. This creates:
   - `admin@aaharlink.demo` (admin)
   - `supplier@aaharlink.demo` (supplier, with 2 sample food listings)
   - `org@aaharlink.demo` (organization, **pre-approved**)

   All three use the password `Demo1234!`. Log in at `login.html` with any of them.

   Alternatively, register through the UI: **Authentication → Providers → Email → turn off "Confirm email"** first if you hit confirmation/rate-limit errors while testing repeatedly.
6. **To promote a UI-registered user to admin**, use the Supabase dashboard's Table editor to change that user's `role` to `admin` in the `users` table.

### Updating an existing Supabase project

If `schema.sql` was already installed earlier, run these migrations once in this order from the Supabase SQL editor:

1. `supabase/fix-rls-recursion.sql`
2. `supabase/add-pickup-communication.sql`

If an older version was already installed and accepting a request reports that
`gen_random_bytes(integer)` does not exist, run
`supabase/fix-pickup-code-generator.sql` once.

The second migration adds consent-based phone sharing and guarded database functions for request, accept/reject, two-sided collection confirmation, and admin-only organization verification.

## Pickup flow

1. A verified organization requests an available listing. The database reserves the request slot atomically and the supplier receives a best-effort email.
2. The supplier accepts. The database creates the pickup code; only the organization UI displays it. Both sides receive the pickup details and the partner's phone only when that partner opted in.
3. At handover, the organization shows the code to the supplier. The supplier enters it and the organization separately clicks **Confirm food received**.
4. Only after both confirmations does the database mark the request and listing as collected. Both sides then receive a receipt email containing the food, quantity, place, completion time, reference, and consented contact number.

## Run it locally

No build step is required — any static file server works, for example:

```bash
npx serve .
```

Then visit the URL it prints.

### Testing multiple roles in one browser

Authentication is isolated with per-tab `sessionStorage`. Open two separate
tabs from the site URL, log in as the organization in one tab and as the
supplier in the other, and operate both sides of the pickup flow in parallel.
Navigation and refresh keep each tab's own session. Closing a tab clears that
tab's session. After upgrading from the older shared-login version, sign in
again once in each tab.

## Security notes

Supabase's Row Level Security is the only security layer, since JavaScript runs entirely in the browser:

- Only the **anon/public** key is ever used client-side (never the `service_role` key).
- Only **approved** organizations can insert into `pickup_requests`.
- Users can only read/update their own `users` and `organizations` rows (admins can read/update all).
- Food photos are public-read; verification documents are only readable by their owner and admins.

## Known limitations

- The 1-hour-before-deadline email reminder in `js/notifications.js` only fires while someone has the app open in a browser tab. A production deployment should replace it with a scheduled Supabase Edge Function.
- EmailJS sends run client-side; failures are logged to the console and never block the pickup workflow.
