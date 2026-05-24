import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-safe class composer. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTRY(amount: number): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
  }).format(amount);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'medium',
  }).format(d);
}

/** Short Turkish date + time, e.g. "18.05.2026 11:25". */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d);
}

// Turkey is UTC+3 year-round. "Today" must be the Europe/Istanbul calendar
// date — deriving it from UTC or browser-local time drifts by a day between
// 00:00 and 03:00 Istanbul. This is the single source of truth for "today".
const istanbulDayFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Istanbul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's calendar date in Europe/Istanbul as 'YYYY-MM-DD'. */
export function istanbulToday(): string {
  // formatToParts gives locale-stable named parts regardless of join order.
  const parts = istanbulDayFmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Yönetici',
  PROPERTY_MANAGER: 'Alt Yönetici',
  RECEPTION: 'Resepsiyon',
  HOUSEKEEPING: 'Temizlik',
  YETKILI: 'Yetkili',
  PENDING: 'Onay Bekliyor',
};

/** Friendly label for a staff role. Falls back to the raw value for unknown roles. */
export function formatRole(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

const SCOPE_LABELS: Record<string, string> = {
  ALL: 'Tüm Mülkler',
  HOTELS: 'Binalar',
  APARTMENTS: 'Daireler',
};

/** Friendly label for a staff access scope (migration 033). */
export function formatScope(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope;
}

const ROOM_TYPE_LABELS: Record<string, string> = {
  SINGLE: 'Tek Kişilik',
  DOUBLE: 'Çift Kişilik',
  TRIPLE: 'Üç Kişilik',
  QUAD: 'Dört Kişilik',
};

const HOTEL_ROOM_CAPACITY: Record<string, number> = {
  SINGLE: 1,
  DOUBLE: 2,
  TRIPLE: 3,
  QUAD: 4,
};

/** Friendly label for a room type. Falls back to raw value for apartment types. */
export function formatRoomType(roomType: string): string {
  return ROOM_TYPE_LABELS[roomType] ?? roomType;
}

/** Capacity implied by a hotel room type, or null for apartment types. */
export function capacityFromRoomType(roomType: string): number | null {
  return HOTEL_ROOM_CAPACITY[roomType] ?? null;
}

/**
 * Normalize a Turkish-or-international phone number into the digits-only
 * country-code-prefixed form wa.me expects (e.g. "905551234567").
 * Returns null when the input is missing or clearly invalid.
 */
export function toWhatsAppPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  // Trim a leading 0 — Turkish local format "0555…" becomes "555…"
  if (digits.startsWith('0')) digits = digits.slice(1);
  // 10-digit number with no country code → assume Turkey (+90)
  if (digits.length === 10 && !digits.startsWith('90')) {
    digits = '90' + digits;
  }
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

/** Build a wa.me URL with the message URL-encoded. */
export function whatsAppUrl(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

/**
 * Build a wa.me URL with NO recipient — opens WhatsApp and lets the user
 * pick which chat to send to. Used when the guest has no saved phone or
 * the message is going to someone not in the guest record.
 */
export function whatsAppShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
