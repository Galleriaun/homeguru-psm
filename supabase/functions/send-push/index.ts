// HomeGuru PMS — send-push Edge Function.
//
// POST /functions/v1/send-push
// Auth: requires the project's service_role key in the Authorization header
//       (DB triggers via pg_net + the app's own admin code can call this).
//
// Body shape:
//   {
//     "user_ids"?: string[],          // explicit recipient list
//     "roles"?:    string[],          // OR resolve recipients by staff role
//     "title":     string,            // required
//     "body"?:     string,
//     "url"?:      string,
//     "kind":      'issue' | 'payment' | 'reservation' | 'system',
//     "data"?:     Record<string, unknown>
//   }
//
// What it does:
//   1. Resolve recipients from user_ids + roles (deduped).
//   2. Insert an audit row into `notifications` per recipient.
//   3. Look up active push_subscriptions for those users.
//   4. Send Web Push to each in parallel via VAPID.
//   5. Delete subscriptions the push service rejects with 404/410 (gone).

import { createClient } from 'npm:@supabase/supabase-js@2';
import webPush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;

webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

interface SendPushBody {
  user_ids?: string[];
  roles?: string[];
  title: string;
  body?: string;
  url?: string;
  kind: 'issue' | 'payment' | 'reservation' | 'system';
  data?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  // Auth gate — only the service role can invoke this. DB triggers via pg_net
  // pass the service role key; nobody else has it.
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: SendPushBody;
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  if (!payload.title || !payload.kind) {
    return new Response('Missing title/kind', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Resolve recipients.
  const recipientSet = new Set<string>(payload.user_ids ?? []);
  if (payload.roles && payload.roles.length > 0) {
    const { data: rows } = await supabase
      .from('staff_profiles')
      .select('user_id')
      .in('role', payload.roles);
    for (const r of rows ?? []) recipientSet.add(r.user_id);
  }
  const recipients = [...recipientSet];

  if (recipients.length === 0) {
    return Response.json({ sent: 0, reason: 'no recipients' });
  }

  // Audit log (one row per recipient).
  await supabase.from('notifications').insert(
    recipients.map((uid) => ({
      user_id: uid,
      title: payload.title,
      body: payload.body ?? null,
      url: payload.url ?? null,
      kind: payload.kind,
      data: payload.data ?? null,
    })),
  );

  // Active subscriptions for those users.
  const { data: subs, error: subsErr } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, user_id')
    .in('user_id', recipients);

  if (subsErr) {
    return new Response(`subs lookup failed: ${subsErr.message}`, { status: 500 });
  }
  if (!subs || subs.length === 0) {
    return Response.json({ sent: 0, reason: 'no subscriptions' });
  }

  // Build the push payload. `tag` collapses repeat notifications of the same
  // kind+entity so a flurry of triggers doesn't stack 10 banners.
  const tag =
    payload.data && typeof payload.data === 'object' && 'id' in payload.data
      ? `${payload.kind}:${String((payload.data as Record<string, unknown>).id)}`
      : payload.kind;
  const pushPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url,
    tag,
  });

  const expiredSubIds: string[] = [];
  let successCount = 0;

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          pushPayload,
        );
        successCount++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Subscription is gone (user uninstalled / browser purged).
          expiredSubIds.push(sub.id);
        }
        console.warn('[send-push] failed', sub.endpoint, status, err);
      }
    }),
  );

  if (expiredSubIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expiredSubIds);
  }

  return Response.json({
    sent: successCount,
    total: subs.length,
    expired: expiredSubIds.length,
  });
});
