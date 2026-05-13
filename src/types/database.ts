/**
 * Type-safe Database shape for the Supabase client.
 *
 * ⚠️ This file is a manual scaffold. After running migrations in Supabase,
 * regenerate it with the Supabase CLI for fully accurate types:
 *
 *   npx supabase gen types typescript --project-id <ref> --schema public > src/types/database.ts
 *
 * The shape must match what `supabase-js` expects for type inference to work.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Role = 'SUPER_ADMIN' | 'PROPERTY_MANAGER' | 'RECEPTION' | 'HOUSEKEEPING';
export type PropertyType = 'HOTEL' | 'APARTMENT';
export type RoomType =
  | '1+0' | '1+1' | '2+1'         // Apartment layouts
  | 'SINGLE' | 'DOUBLE' | 'TRIPLE' | 'QUAD'; // Hotel rooms (capacity-named)
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
        Insert: {
          id?: string;
          name: string;
          type: PropertyType;
          address?: string | null;
          manager_user_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          type?: PropertyType;
          address?: string | null;
          manager_user_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
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
        Insert: {
          id?: string;
          property_id: string;
          name: string;
          room_type: RoomType;
          capacity: number;
          base_price: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          property_id?: string;
          name?: string;
          room_type?: RoomType;
          capacity?: number;
          base_price?: number;
          created_at?: string;
        };
        Relationships: [];
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
        Insert: {
          user_id: string;
          full_name: string;
          role: Role;
          property_id?: string | null;
          salary?: number | null;
          hire_date?: string | null;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          full_name?: string;
          role?: Role;
          property_id?: string | null;
          salary?: number | null;
          hire_date?: string | null;
          created_at?: string;
        };
        Relationships: [];
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
        Insert: {
          id?: string;
          full_name: string;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          nationality?: string | null;
          consent_given_at?: string | null;
          consent_version?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          nationality?: string | null;
          consent_given_at?: string | null;
          consent_version?: string | null;
          created_at?: string;
        };
        Relationships: [];
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
        Insert: {
          id?: string;
          property_id: string;
          unit_id: string;
          guest_id: string;
          stay_start: string;
          stay_end: string;
          status: ReservationStatus;
          total_amount: number;
          deposit?: number;
          auto_debit?: boolean;
          created_by: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          property_id?: string;
          unit_id?: string;
          guest_id?: string;
          stay_start?: string;
          stay_end?: string;
          status?: ReservationStatus;
          total_amount?: number;
          deposit?: number;
          auto_debit?: boolean;
          created_by?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
