// js/supabase-client.js
// Initializes one shared Supabase client for the whole app.
//
// SETUP: create a free project at https://supabase.com, then paste your
// project URL and public anon key below. Never put your service_role key
// in client-side code — only the anon key belongs here.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://mzapvqwdyjakbybahskf.supabase.co"; 
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YXB2cXdkeWpha2J5YmFoc2tmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkyMTgwNzMsImV4cCI6MjEwNDc5NDA3M30.dlQrZQpJH3pmS-sjdt5gEoqihTP4Kd-VvtugZKtuNSQ"; // TODO: replace with your Supabase anon/public key (starts with "eyJ", found under Project Settings > Data API)

// Keep authentication isolated per browser tab. Supabase normally persists
// auth in localStorage, which makes logging in as an organization in one tab
// replace the supplier session in every other tab. sessionStorage survives
// navigation/reloads in this tab but is not shared with separately opened tabs.
const AUTH_TAB_ID_KEY = "foodbridge_auth_tab_id";
let authTabId = sessionStorage.getItem(AUTH_TAB_ID_KEY);
if (!authTabId) {
  authTabId = crypto.randomUUID();
  sessionStorage.setItem(AUTH_TAB_ID_KEY, authTabId);
}
const projectRef = new URL(SUPABASE_URL).hostname.split(".")[0];
const authStorageKey = `sb-${projectRef}-auth-${authTabId}`;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: sessionStorage,
    storageKey: authStorageKey,
  },
});

export const isSupabaseConfigured =
  !SUPABASE_URL.includes("YOUR-PROJECT-REF") && !SUPABASE_ANON_KEY.includes("YOUR-SUPABASE-ANON-KEY");

export const STORAGE_BUCKET_LISTINGS = "food-photos";
export const STORAGE_BUCKET_DOCUMENTS = "org-documents";
