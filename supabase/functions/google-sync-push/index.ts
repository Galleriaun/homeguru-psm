// HomeGuru PMS — google-sync-push Edge Function.
//
// POST /functions/v1/google-sync-push
// Auth: requires service_role key (called by DB triggers via pg_net).
//
// Body shape:
//   { op: 'upsert', reservation_id: uuid }
//   { op: 'delete', google_event_id: string }
//
// What it does:
//   upsert → load reservation + guest + unit + property
//           build a Google Calendar event payload (summary, description,
//           start/end, extendedProperties.private.homeguru_id)
//           if reservation.google_event_id already set → PATCH that event
//           else → POST a new event, store the returned event id back on
//           the reservation. extendedProperties tag prevents the pull side
//           from re-importing our own pushes.
//   delete → DELETE the Google event (best-effort; missing = noop).

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET')!;

interface UpsertBody { op: 'upsert'; reservation_id: string }
interface DeleteBody { op: 'delete'; google_event_id: string }
type Body = UpsertBody | DeleteBody;

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  let payload: Body;
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const tokens = await getConnectedTokens(supabase);
  if (!tokens) {
    // No owner has connected yet — nothing to sync. Not an error.
    return Response.json({ skipped: 'no connected calendar' });
  }
  const accessToken = await ensureFreshAccessToken(supabase, tokens);
  const calendarId = encodeURIComponent(tokens.calendar_id);

  if (payload.op === 'delete') {
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${payload.google_event_id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    // 404 = already gone; 410 = deleted; both are fine.
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      const text = await res.text();
      return new Response(`Google delete failed: ${text}`, { status: 500 });
    }
    return Response.json({ deleted: payload.google_event_id });
  }

  // op === 'upsert'
  const { data: rezRow, error: rezErr } = await supabase
    .from('reservations')
    .select(
      'id, stay_start, stay_end, status, stay_type, late_checkout_hours, google_event_id, ' +
      'guest:guests(full_name, phone), unit:units(name), property:properties(name)',
    )
    .eq('id', payload.reservation_id)
    .maybeSingle();
  if (rezErr) {
    return new Response(`load failed: ${rezErr.message}`, { status: 500 });
  }
  if (!rezRow) {
    return Response.json({ skipped: 'reservation gone' });
  }

  const eventBody = buildEventBody(rezRow);

  if (rezRow.google_event_id) {
    // PATCH existing event so its history on Google is preserved.
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${rezRow.google_event_id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventBody),
      },
    );
    if (!res.ok) {
      // 404 means the event was deleted on Google's side — fall through and
      // create a fresh one instead of treating this as a hard failure.
      if (res.status !== 404) {
        const text = await res.text();
        return new Response(`Google patch failed: ${text}`, { status: 500 });
      }
    } else {
      return Response.json({ updated: rezRow.google_event_id });
    }
  }

  // INSERT a brand-new event.
  const insertRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    },
  );
  if (!insertRes.ok) {
    const text = await insertRes.text();
    return new Response(`Google insert failed: ${text}`, { status: 500 });
  }
  const created = await insertRes.json() as { id: string };

  // Write the event id back onto the reservation. The UPDATE column list on
  // the trigger doesn't include google_event_id, so this doesn't re-fire.
  await supabase
    .from('reservations')
    .update({ google_event_id: created.id })
    .eq('id', rezRow.id);

  return Response.json({ created: created.id });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TokenRow {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  calendar_id: string;
}

async function getConnectedTokens(
  supabase: ReturnType<typeof createClient>,
): Promise<TokenRow | null> {
  // Single-owner workflow: just grab whichever connected row exists. Future
  // multi-tenant work can scope this per branch/property.
  const { data } = await supabase
    .from('google_oauth_tokens')
    .select('user_id, access_token, refresh_token, expires_at, calendar_id')
    .limit(1)
    .maybeSingle();
  return (data as TokenRow | null) ?? null;
}

async function ensureFreshAccessToken(
  supabase: ReturnType<typeof createClient>,
  row: TokenRow,
): Promise<string> {
  // 60-second skew so a request made right at the boundary doesn't 401.
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
  if (!res.ok) {
    throw new Error(`refresh failed: ${await res.text()}`);
  }
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

interface ReservationForEvent {
  id: string;
  stay_start: string;
  stay_end: string;
  status: string;
  stay_type: string;
  late_checkout_hours: number | null;
  google_event_id: string | null;
  guest: { full_name: string; phone: string | null } | null;
  unit: { name: string } | null;
  property: { name: string } | null;
}

function buildEventBody(r: ReservationForEvent): Record<string, unknown> {
  const guest = r.guest?.full_name ?? 'Misafir';
  const unit = r.unit?.name ?? '';
  const property = r.property?.name ?? '';
  const statusTag =
    r.status === 'cancelled' ? ' [İptal]' :
    r.status === 'completed' ? ' [Tamamlandı]' : '';
  const summary = `${guest} — ${property} ${unit}`.trim() + statusTag;

  // Overnight end-of-stay clock — HomeGuru stores stay_end at midnight UTC
  // for overnight reservations, but the display + Google event should show
  // the customary 11:00 Istanbul checkout (plus any late_checkout_hours).
  // For DAYUSE the stored times are already the real start/end.
  let endIso = r.stay_end;
  if (r.stay_type !== 'DAYUSE') {
    const hour = 11 + (r.late_checkout_hours ?? 0);
    // stay_end is midnight UTC of checkout date → set to hour:00 Istanbul.
    // Istanbul = UTC+3 year-round → hour Istanbul = (hour-3) UTC.
    const d = new Date(r.stay_end);
    d.setUTCHours(hour - 3, 0, 0, 0);
    endIso = d.toISOString();
  }

  const description = [
    r.guest?.phone ? `Tel: ${r.guest.phone}` : '',
    `HomeGuru: ${r.id}`,
  ].filter(Boolean).join('\n');

  return {
    summary,
    description,
    start: { dateTime: r.stay_start, timeZone: 'Europe/Istanbul' },
    end:   { dateTime: endIso,        timeZone: 'Europe/Istanbul' },
    // The tag — every event we create carries this. The pull side checks
    // for its presence and skips events that already came from us.
    extendedProperties: {
      private: {
        homeguru_id: r.id,
      },
    },
    // If the reservation was cancelled, also flip Google's status — gives
    // the calendar's UI the cancelled-event treatment (strikethrough etc.).
    status: r.status === 'cancelled' ? 'cancelled' : 'confirmed',
  };
}
