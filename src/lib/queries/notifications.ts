import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

export type NotificationRow = Database['public']['Tables']['notifications']['Row'];

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

/** Only the last 15 days are shown (a cron prunes older rows — migration 127). */
const WINDOW_DAYS = 15;
/** Hard ceiling so a busy account can't load thousands of rows into memory. */
const MAX_ROWS = 200;

function windowStartISO(): string {
  return new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Filter categories. Derived from event_type (the semantically meaningful
// field) — NOT `kind`, which doesn't align: reservation_auto_completed is
// kind='system' yet clearly a reservation. An unknown/null event_type falls
// back to 'diger', so a new event type can never vanish from the list.
// ---------------------------------------------------------------------------
export type NotifCategory = 'rezervasyon' | 'onay' | 'sorun' | 'diger';

export const NOTIF_CATEGORY_LABELS: Record<NotifCategory, string> = {
  rezervasyon: 'Rezervasyon',
  onay: 'Onay',
  sorun: 'Sorun',
  diger: 'Diğer',
};

/** Fixed display order for the filter chips. */
export const NOTIF_CATEGORY_ORDER: NotifCategory[] = ['rezervasyon', 'onay', 'sorun', 'diger'];

const EVENT_CATEGORY: Record<string, NotifCategory> = {
  new_reservation: 'rezervasyon',
  reservation_changed: 'rezervasyon',
  upcoming_reservation_2d: 'rezervasyon',
  reservation_auto_completed: 'rezervasyon',
  pending_google_reservation: 'rezervasyon',
  payment_unconfirmed: 'onay',
  pending_approval: 'onay',
  new_issue: 'sorun',
  salary_auto_paid: 'diger',
};

export function notifCategory(n: NotificationRow): NotifCategory {
  return (n.event_type && EVENT_CATEGORY[n.event_type]) || 'diger';
}

// ---------------------------------------------------------------------------
// Queries. RLS scopes every row to auth.uid(), so no user filter is needed.
// ---------------------------------------------------------------------------

/** This user's notifications from the last 15 days, newest first. */
export async function listNotifications(): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .gte('created_at', windowStartISO())
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw wrapErr(error);
  return data ?? [];
}

/** Count of unread notifications in the 15-day window (drives the bell badge). */
export async function countUnreadNotifications(): Promise<number> {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
    .gte('created_at', windowStartISO());
  if (error) throw wrapErr(error);
  return count ?? 0;
}

/** Mark one notification read. No-op server-side if already read. */
export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null);
  if (error) throw wrapErr(error);
}

/** Mark every unread notification in the window read. */
export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
    .gte('created_at', windowStartISO());
  if (error) throw wrapErr(error);
}
