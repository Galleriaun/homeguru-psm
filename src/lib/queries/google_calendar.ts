import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

type TokenRow = Database['public']['Tables']['google_oauth_tokens']['Row'];
type PendingRow = Database['public']['Tables']['pending_google_reservations']['Row'];

export type GoogleConnection = Pick<
  TokenRow,
  'user_id' | 'calendar_id' | 'connected_at'
>;
export type PendingGoogleReservation = PendingRow;

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

// =============================================================================
// OAuth lifecycle
// =============================================================================

/**
 * Build the URL that kicks off Google's OAuth consent flow. The state param
 * is the user's auth.users.id so the callback Edge Function knows whose
 * tokens to persist. prompt=consent forces Google to return a refresh_token
 * even when the user has previously authorized the app — without it, the
 * second connect attempt would silently fail with a missing refresh_token.
 */
export function buildGoogleOAuthUrl(userId: string): string {
  const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID as string | undefined;
  const supaUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!clientId || !supaUrl) {
    throw new Error(
      'Google Takvim entegrasyonu için VITE_GOOGLE_OAUTH_CLIENT_ID ayarlanmamış.',
    );
  }
  const redirectUri = `${supaUrl}/functions/v1/google-oauth-callback`;
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar');
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', userId);
  return u.toString();
}

/**
 * Returns the connected calendar info for the current user, or null if not
 * connected. We never read access/refresh tokens client-side — only the
 * presence/metadata is needed to drive the UI.
 */
export async function getGoogleConnection(): Promise<GoogleConnection | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('google_oauth_tokens')
    .select('user_id, calendar_id, connected_at')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw wrapErr(error);
  return data;
}

/**
 * Sever the link by deleting the row. RLS gates DELETE to SUPER_ADMIN.
 * The Google-side authorization stays valid until the owner manually revokes
 * it at https://myaccount.google.com/permissions — we surface that hint in
 * the disconnect flow.
 */
export async function disconnectGoogleCalendar(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Oturum bulunamadı.');
  const { error } = await supabase
    .from('google_oauth_tokens')
    .delete()
    .eq('user_id', user.id);
  if (error) throw wrapErr(error);
}

// =============================================================================
// Pending Google reservations (the "Beklemede - Google" review queue)
// =============================================================================

export async function listPendingGoogleReservations(): Promise<PendingGoogleReservation[]> {
  const { data, error } = await supabase
    .from('pending_google_reservations')
    .select('*')
    .eq('status', 'pending')
    .order('start_at', { ascending: true });
  if (error) throw wrapErr(error);
  return data ?? [];
}

/**
 * Mark a pending Google row as dismissed (e.g. customer cancelled before the
 * owner got to it). Does not touch the Google-side event — for that the owner
 * deletes it directly in Google Calendar.
 */
export async function dismissPendingGoogleReservation(id: string): Promise<void> {
  const { error } = await supabase
    .from('pending_google_reservations')
    .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw wrapErr(error);
}

/**
 * Mark the pending row as imported and link it to the freshly-created
 * reservation. Called by the assign-unit flow AFTER the reservation insert
 * succeeds.
 */
export async function markPendingImported(
  pendingId: string,
  reservationId: string,
): Promise<void> {
  const { error } = await supabase
    .from('pending_google_reservations')
    .update({
      status: 'imported',
      reservation_id: reservationId,
      imported_at: new Date().toISOString(),
    })
    .eq('id', pendingId);
  if (error) throw wrapErr(error);
}
