import { supabase } from '@/lib/supabase';
import { getGuestDecrypted } from '@/lib/queries/guests';
import { formatDate } from '@/lib/utils';
import type { Database, KbsStatus } from '@/types/database';

type KbsRow = Database['public']['Tables']['kbs_submissions']['Row'];

/**
 * Denormalized shape used by the KBS list page — pulls names from joined
 * reservations → guests / units / properties so the table can render without
 * extra round-trips. TC/passport are intentionally NOT in this shape; they
 * stay encrypted at rest and are only decrypted on-demand by getKbsCopyText.
 */
export interface KbsListItem extends KbsRow {
  reservation: {
    id: string;
    stay_start: string;
    stay_end: string;
    status: string;
  } | null;
  guest: {
    id: string;
    full_name: string;
    nationality: string | null;
    phone: string | null;
  } | null;
  property: { name: string } | null;
  unit: { name: string } | null;
}

const wrapErr = (e: { message: string; details?: string; hint?: string; code?: string }) =>
  new Error(
    `${e.message}${e.details ? ` — ${e.details}` : ''}${e.hint ? ` [${e.hint}]` : ''}${e.code ? ` (${e.code})` : ''}`,
  );

/**
 * Lists all KBS submission rows visible to the caller (RLS scopes by branch
 * for non-admins). PostgREST does the joins so the list is one round-trip.
 */
export async function listKbsSubmissions(): Promise<KbsListItem[]> {
  const { data, error } = await supabase
    .from('kbs_submissions')
    .select(
      `
      id, reservation_id, payload, status, response_code, response_body,
      retry_count, submitted_at, created_at,
      reservation:reservations(
        id, stay_start, stay_end, status,
        guest:guests(id, full_name, nationality, phone),
        property:properties(name),
        unit:units(name)
      )
      `,
    )
    .order('created_at', { ascending: false });
  if (error) throw wrapErr(error);

  // Flatten the nested reservation join into the top-level shape used by the UI.
  type Raw = KbsRow & {
    reservation: {
      id: string;
      stay_start: string;
      stay_end: string;
      status: string;
      guest: { id: string; full_name: string; nationality: string | null; phone: string | null } | null;
      property: { name: string } | null;
      unit: { name: string } | null;
    } | null;
  };
  return (data as unknown as Raw[] | null)?.map((r) => ({
    ...r,
    reservation: r.reservation
      ? {
          id: r.reservation.id,
          stay_start: r.reservation.stay_start,
          stay_end: r.reservation.stay_end,
          status: r.reservation.status,
        }
      : null,
    guest: r.reservation?.guest ?? null,
    property: r.reservation?.property ?? null,
    unit: r.reservation?.unit ?? null,
  })) ?? [];
}

/** Update a KBS row's status — used for "Bildirildi olarak işaretle" + revert. */
export async function markKbsStatus(
  id: string,
  status: KbsStatus,
): Promise<KbsRow> {
  const updates: Database['public']['Tables']['kbs_submissions']['Update'] = {
    status,
    submitted_at: status === 'SUBMITTED' || status === 'CONFIRMED' ? new Date().toISOString() : null,
  };
  const { data, error } = await supabase
    .from('kbs_submissions')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw wrapErr(error);
  return data;
}

/**
 * Build the formatted text that the user copies into the KBS web portal.
 * Calls get_guest_decrypted under the hood (audit-logged per call, per KVKK).
 * Returns null if the guest record can't be fetched (deleted, RLS, etc.).
 */
export async function getKbsCopyText(item: KbsListItem): Promise<string | null> {
  if (!item.guest || !item.reservation) return null;
  const decrypted = await getGuestDecrypted(item.guest.id);
  if (!decrypted) return null;

  const lines: string[] = ['KBS Bildirim — Rezervasyon'];
  lines.push(`Misafir: ${decrypted.full_name}`);
  if (decrypted.nationality) lines.push(`Uyruk: ${decrypted.nationality}`);
  lines.push(`TC Kimlik: ${decrypted.tc_kimlik ?? '(yok)'}`);
  lines.push(`Pasaport: ${decrypted.passport ?? '(yok)'}`);
  if (decrypted.phone) lines.push(`Telefon: ${decrypted.phone}`);
  lines.push(`Giriş: ${formatDate(item.reservation.stay_start)}`);
  lines.push(`Çıkış: ${formatDate(item.reservation.stay_end)}`);
  if (item.property?.name) lines.push(`Mülk: ${item.property.name}`);
  if (item.unit?.name) lines.push(`Birim: ${item.unit.name}`);
  return lines.join('\n');
}
