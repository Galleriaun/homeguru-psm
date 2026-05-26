// HomeGuru PMS — google-sync-pull Edge Function.
//
// POST /functions/v1/google-sync-pull
// Auth: requires service_role key (called by pg_cron via pg_net).
//
// What it does:
//   1. Look up the connected owner's tokens (single-tenant).
//   2. Refresh access token if expired.
//   3. Call Google Calendar events.list with last_sync_token for incremental
//      sync (full list with timeMin=now on first run / after a 410).
//   4. For each event:
//        - Skip if extendedProperties.private.homeguru_id is set (ours).
//        - Skip if a reservations row already has google_event_id matching.
//        - Otherwise upsert into pending_google_reservations by google_event_id.
//   5. Persist the new syncToken for next run.
//
// A 410 Gone from Google means our syncToken is too old → clear it and
// next run does a full fetch (bounded by timeMin = today).

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')!;

interface TokenRow {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  calendar_id: string;
  last_sync_token: string | null;
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: tokens } = await supabase
    .from('google_oauth_tokens')
    .select('user_id, access_token, refresh_token, expires_at, calendar_id, last_sync_token')
    .limit(1)
    .maybeSingle();
  if (!tokens) {
    return Response.json({ skipped: 'no connected calendar' });
  }
  const row = tokens as TokenRow;
  const accessToken = await ensureFreshAccessToken(supabase, row);

  const calendarId = encodeURIComponent(row.calendar_id);
  let nextPageToken: string | undefined;
  let nextSyncToken: string | undefined;
  let queued = 0;
  let skippedOurs = 0;

  // Loop over pages.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const params = new URLSearchParams();
    if (row.last_sync_token) {
      params.set('syncToken', row.last_sync_token);
    } else {
      // First run / after 410: bound the initial fetch to today onwards so
      // we don't import years of history.
      params.set('timeMin', new Date().toISOString());
      params.set('singleEvents', 'true');
    }
    if (nextPageToken) params.set('pageToken', nextPageToken);
    params.set('maxResults', '250');

    const listRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (listRes.status === 410) {
      // Sync token expired — clear it so the next invocation does a full pull.
      await supabase
        .from('google_oauth_tokens')
        .update({ last_sync_token: null, updated_at: new Date().toISOString() })
        .eq('user_id', row.user_id);
      return Response.json({ resync: true });
    }
    if (!listRes.ok) {
      return new Response(`list failed: ${await listRes.text()}`, { status: 500 });
    }
    const listJson = await listRes.json() as {
      items?: GoogleEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };

    for (const event of listJson.items ?? []) {
      const result = await handleEvent(supabase, event);
      if (result === 'queued') queued++;
      if (result === 'ours') skippedOurs++;
    }

    if (listJson.nextPageToken) {
      nextPageToken = listJson.nextPageToken;
      continue;
    }
    nextSyncToken = listJson.nextSyncToken;
    break;
  }

  if (nextSyncToken) {
    await supabase
      .from('google_oauth_tokens')
      .update({ last_sync_token: nextSyncToken, updated_at: new Date().toISOString() })
      .eq('user_id', row.user_id);
  }

  return Response.json({ queued, skipped_ours: skippedOurs });
});

// ---------------------------------------------------------------------------

interface GoogleEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

async function handleEvent(
  supabase: ReturnType<typeof createClient>,
  ev: GoogleEvent,
): Promise<'queued' | 'ours' | 'skipped'> {
  // Our own pushes carry this tag — never re-import them.
  if (ev.extendedProperties?.private?.homeguru_id) {
    return 'ours';
  }
  // Defensive cross-check: if we already linked any reservation to this id,
  // treat as ours even when the tag was stripped externally.
  const { data: linked } = await supabase
    .from('reservations')
    .select('id')
    .eq('google_event_id', ev.id)
    .maybeSingle();
  if (linked) {
    return 'ours';
  }

  // Cancelled events from Google — if we had a pending row for it, mark
  // dismissed so it stops showing in the queue. New cancellations of events
  // we never queued are just ignored.
  if (ev.status === 'cancelled') {
    await supabase
      .from('pending_google_reservations')
      .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
      .eq('google_event_id', ev.id)
      .eq('status', 'pending');
    return 'skipped';
  }

  const startIso = ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00Z` : null);
  const endIso = ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00Z` : null);
  if (!startIso || !endIso) {
    return 'skipped';
  }

  // Upsert by google_event_id so repeated polls don't duplicate.
  const { error } = await supabase
    .from('pending_google_reservations')
    .upsert(
      {
        google_event_id: ev.id,
        summary: ev.summary ?? null,
        description: ev.description ?? null,
        start_at: startIso,
        end_at: endIso,
        raw_payload: ev,
      },
      { onConflict: 'google_event_id' },
    );
  if (error) {
    console.warn('[google-sync-pull] upsert failed', error);
    return 'skipped';
  }
  return 'queued';
}

async function ensureFreshAccessToken(
  supabase: ReturnType<typeof createClient>,
  row: TokenRow,
): Promise<string> {
  if (Date.now() < new Date(row.expires_at).getTime() - 60_000) {
    return row.access_token;
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`refresh failed: ${await res.text()}`);
  const json = await res.json() as { access_token: string; expires_in: number };
  const newExpires = new Date(Date.now() + json.expires_in * 1000).toISOString();
  await supabase
    .from('google_oauth_tokens')
    .update({
      access_token: json.access_token,
      expires_at: newExpires,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', row.user_id);
  return json.access_token;
}
