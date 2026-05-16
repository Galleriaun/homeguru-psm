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

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Süper Admin',
  PROPERTY_MANAGER: 'Yönetici',
  RECEPTION: 'Resepsiyon',
  HOUSEKEEPING: 'Temizlik',
};

/** Friendly label for a staff role. Falls back to the raw value for unknown roles. */
export function formatRole(role: string): string {
  return ROLE_LABELS[role] ?? role;
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
