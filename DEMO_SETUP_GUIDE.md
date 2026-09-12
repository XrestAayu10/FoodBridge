# FoodBridge Demo Setup Guide

This guide is for setting up the FoodBridge project on another laptop for a live demo using Supabase.

## 1) Clone the project

```bash
git clone https://github.com/XrestAayu10/FoodBridge.git
cd FoodBridge
```

Open the folder in VS Code.

## 2) Install the app locally

No build step is required. Run:

```bash
npx serve .
```

Then open the URL shown in the terminal, usually:

```text
http://localhost:3000
```

or

```text
http://localhost:5500
```

## 3) Create a new Supabase project

Go to:
- https://supabase.com
- Create a new project
- Wait for the project to finish provisioning

You will need:
- Project URL
- Project anon/public key
- Project service_role key (only for seeding demo data)

## 4) Run the database schema

Open the Supabase Dashboard:
- SQL Editor
- New query
- Paste the full contents of `supabase/schema.sql`
- Click Run

This creates:
- users
- organizations
- food_listings
- pickup_requests
- notifications
- storage buckets
- RLS policies

Important:
- If you hit RLS or policy errors, run the same SQL file again.
- The file is written to be re-runnable.

## 5) Disable email confirmation for the demo

For a smooth demo, go to:
- Authentication → Providers → Email
- Turn off "Confirm email"

This prevents email rate limits during quick testing.

## 6) Configure the browser app to use your Supabase project

Edit `js/supabase-client.js` and set:

```js
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
```

Use your project URL and anon key.

Important:
- This must stay in the browser app
- Do not put the service_role key here
- Do not commit secrets to GitHub

## 7) Seed demo users

Open a terminal in the project folder and run:

```bash
export SUPABASE_URL="https://YOUR-PROJECT-REF.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="YOUR-SERVICE-ROLE-KEY"
node supabase/seed-demo-users.mjs
```

This creates demo accounts:
- admin@foodbridge.demo
- supplier@foodbridge.demo
- org@foodbridge.demo

Password for all demo users:

```text
Demo1234!
```

## 8) Check that the users exist

In Supabase Dashboard:
- Table Editor
- Open the `users` table

Verify that the three demo users exist and have the correct roles:
- admin
- supplier
- organization

Also verify the `organizations` table has the demo organization marked as approved.

## 9) Run the app and test the demo flow

Start the app:

```bash
npx serve .
```

### Supplier demo
- Log in as `supplier@foodbridge.demo`
- Open supplier dashboard
- Post a food listing

### Organization demo
- Log in as `org@foodbridge.demo`
- Browse available listings
- Request a pickup

### Supplier acceptance flow
- Log in again as supplier
- Accept the pickup request
- View the generated pickup code

### Collection confirmation
- Log in as organization
- Confirm pickup as received
- Supplier confirms too
- Status becomes `collected`

### Admin demo
- Log in as `admin@foodbridge.demo`
- Review organization verification queue
- View impact dashboard

## 10) Optional: EmailJS setup

If you want email notifications during the demo:
- create a free EmailJS account
- add an email service
- create the required templates
- paste keys and template IDs into `js/notifications.js`

For a quick demo, this is optional and not required for the core flow.

## 11) Common issues and fixes

### Issue: `Could not find the table 'public.users'`

Cause:
- The schema was not run in Supabase.

Fix:
- Re-run `supabase/schema.sql` in SQL Editor.

### Issue: `email rate limit exceeded`

Cause:
- Supabase shared email service hit its limit.

Fix:
- Turn off email confirmation temporarily
- or use custom SMTP

### Issue: RLS or recursion errors

Cause:
- Schema was run before the fix version was applied.

Fix:
- Re-run the full updated `supabase/schema.sql`

### Issue: Data does not show up in the app

Check:
- the correct Supabase URL is in `js/supabase-client.js`
- the correct anon key is in `js/supabase-client.js`
- the schema has run successfully
- the seed script succeeded

## 12) Recommended demo order for tomorrow

Use this exact order:

1. Create fresh Supabase project
2. Run `supabase/schema.sql`
3. Turn off email confirmation
4. Update `js/supabase-client.js`
5. Run `node supabase/seed-demo-users.mjs`
6. Start app with `npx serve .`
7. Login as supplier and post food
8. Login as organization and request pickup
9. Login as supplier and accept request
10. Confirm collection
11. Login as admin and show impact dashboard

## 13) Final warning

Never commit:
- service_role keys
- private Supabase secrets
- any signed auth token

Keep real secrets only in local terminal env variables or secure local storage.

## 14) Demo summary

This setup is the simplest path to a working FoodBridge demo on another laptop:
- new Supabase project
- schema run
- URL + anon key configured
- demo seed script run
- app served locally
- demo users logged in and tested

This should be enough to present the platform in a fast and reliable way.
