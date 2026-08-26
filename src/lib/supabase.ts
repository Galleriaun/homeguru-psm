import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

const url = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !publishableKey) {
  throw new Error(
    'Supabase env vars missing. Copy .env.example to .env.local and fill in your project URL + publishable key.',
  );
}

export const supabase = createClient<Database>(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Required for password reset: the emailed link lands back on this app
    // as `#access_token=...&type=recovery` (implicit flow — the supabase-js
    // default; this project sets no `flowType`). With this off, the client
    // never parses that hash, never establishes the recovery session, and
    // the "PASSWORD_RECOVERY" event on auth.onAuthStateChange never fires —
    // the reset link would land on the app and silently do nothing.
    // Safe to enable: this is also the supabase-js library default, and the
    // app has no other URL-based auth flow (no magic links, no OAuth) that
    // could be affected by it.
    detectSessionInUrl: true,
  },
});
