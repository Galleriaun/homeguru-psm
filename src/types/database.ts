/**
 * Type-safe Database shape for the Supabase client.
 *
 * ⚠️ This file is a manual scaffold. After running migrations in Supabase,
 * regenerate it with:
 *
 *   npx supabase gen types typescript --project-id <ref> --schema public > src/types/database.ts
 */

export type Role = 'SUPER_ADMIN' | 'PROPERTY_MANAGER' | 'RECEPTION' | 'HOUSEKEEPING';
export type PropertyType = 'HOTEL' | 'APARTMENT';
export type RoomType = '1+0' | '1+1' | '2+1' | 'ROOM' | 'SUITE';
export type ReservationStatus = 'pending' | 'active' | 'completed' | 'cancelled';
export type LedgerEntryType = 'DEBT' | 'PAYMENT';
export type PaymentMethod = 'CASH' | 'TRANSFER' | 'CARD';
export type PaymentStatus = 'UNCONFIRMED' | 'CONFIRMED' | 'DISPUTED';
export type HousekeepingStatus = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN';
export type KbsStatus = 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';

export interface Database {
  public: {
    Tables: {
      properties: {
        Row: {
          id: string;
          name: string;
          type: PropertyType;
          address: string | null;
          manager_user_id: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['properties']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['properties']['Insert']>;
      };
      units: {
        Row: {
          id: string;
          property_id: string;
          name: string;
          room_type: RoomType;
          capacity: number;
          base_price: number;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['units']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['units']['Insert']>;
      };
      staff_profiles: {
        Row: {
          user_id: string;
          full_name: string;
          role: Role;
          property_id: string | null;
          salary: number | null;
          hire_date: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['staff_profiles']['Row'], 'created_at'> & {
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['staff_profiles']['Insert']>;
      };
      guests: {
        Row: {
          id: string;
          full_name: string;
          phone: string | null;
          email: string | null;
          address: string | null;
          nationality: string | null;
          consent_given_at: string | null;
          consent_version: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['guests']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['guests']['Insert']>;
      };
      reservations: {
        Row: {
          id: string;
          property_id: string;
          unit_id: string;
          guest_id: string;
          stay_start: string;
          stay_end: string;
          status: ReservationStatus;
          total_amount: number;
          deposit: number;
          auto_debit: boolean;
          created_by: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['reservations']['Row'], 'id' | 'created_at'> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['reservations']['Insert']>;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      role: Role;
      property_type: PropertyType;
      room_type: RoomType;
    };
  };
}
