// HomeGuru PMS — google-oauth-callback Edge Function.
//
// GET /functions/v1/google-oauth-callback?code=...&state=...
//
// Final destination of the Google OAuth 2.0 authorization-code flow. The
// frontend's "Google Takvim'i Bağla" button sends the user to Google's
// consent screen with `state = <user_id>` and our function URL as the
// redirect_uri. Google bounces back here with `code`; we trade the code
// for access + refresh tokens and persist them into google_oauth_tokens.
//
// State trust model: only SUPER_ADMIN can hit the connect button in the UI,
// and the redirect URI is locked at Google's end (only OUR Edge Function
// URL works). So the user_id arriving in `state` is the same user who
// initiated the flow, modulo a determined attacker who's also a logged-in
// SUPER_ADMIN — at which point token theft is the lesser of evils.
//
// After persisting, redirect the browser back to /settings/profile with
// ?google_connected=1 so the React side can render a success banner.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')!;
const APP_BASE_URL =
  Deno.env.get('APP_BASE_URL') ?? 'https://galleriaun.github.io/homeguru-psm';

const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-oauth-callback`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  // The user clicked Cancel on Google's consent screen.
  if (errorParam) {
    return redirectTo(`${APP_BASE_URL}/#/settings/profile?google_error=${encodeURIComponent(errorParam)}`);
  }
  if (!code || !state) {
    return new Response('Missing code/state', { status: 400 });
  }

  // state was set to the user's auth.users.id when the OAuth flow began.
  const userId = state;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    return new Response('Invalid state', { status: 400 });
  }

  // Trade the auth code for tokens.
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return new Response(`Token exchange failed: ${text}`, { status: 500 });
  }
  const tokenJson = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };

  // Google only returns refresh_token on FIRST consent. If the user
  // re-connects without revoking, Google omits it — we must reuse the
  // existing one. Prompt=consent in the auth URL forces a re-grant, so
  // for normal flows we'll always have one here.
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  let refreshToken = tokenJson.refresh_token;
  if (!refreshToken) {
    const { data: existing } = await supabase
      .from('google_oauth_tokens')
      .select('refresh_token')
      .eq('user_id', userId)
      .maybeSingle();
    if (existing?.refresh_token) {
      refreshToken = existing.refresh_token;
    } else {
      return new Response(
        'Google did not return a refresh_token. Revoke the app at https://myaccount.google.com/permissions and try again.',
        { status: 500 },
      );
    }
  }

  const expiresAt = new Date(Date.now() + tokenJson.expires_in * 1000).toISOString();

  const { error: upsertErr } = await supabase
    .from('google_oauth_tokens')
    .upsert(
      {
        user_id: userId,
        access_token: tokenJson.access_token,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        // calendar_id stays at 'primary' unless the owner picks another.
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  if (upsertErr) {
    return new Response(`Failed to store tokens: ${upsertErr.message}`, {
      status: 500,
    });
  }

  return redirectTo(`${APP_BASE_URL}/#/settings/profile?google_connected=1`);
});

function redirectTo(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  });
}
