// The REAL supabase-js client, pointed at the local model server started by
// tests/wire.check.mjs. Used instead of fakeSupabase.mjs when
// HG_FIXTURE_CLIENT=wire, so the query modules are exercised through the same
// library, URLs and headers the app sends in production — just not to
// production.
import { createClient } from '@supabase/supabase-js';

const url = process.env.HG_FIXTURE_URL;
if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) {
  throw new Error('wireSupabase: HG_FIXTURE_URL must be a local http://127.0.0.1:<port> address');
}

export const supabase = createClient(url, 'sb_publishable_fake', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
