/**
 * Type-safe Database shape for the Supabase client.
 *
 * ⚠️ This file is a manual scaffold. After running migrations in Supabase,
 * regenerate it with the Supabase CLI for fully accurate types:
 *
 *   npx supabase gen types typescript --project-id <ref> --schema public > src/types/database.ts
 *
 * Shape must match what `@supabase/supabase-js` expects — use a top-level
 * `type Database = { ... }` alias (NOT interface) and inline all returns.
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
export type AccountType = 'CASH' | 'BANK' | 'CARD';
export type TxDirection = 'IN' | 'OUT';
export type PaymentStatus = 'UNCONFIRMED' | 'CONFIRMED' | 'DISPUTED';
export type HousekeepingStatus = 'DIRTY' | 'IN_PROGRESS' | 'CLEAN';
export type KbsStatus = 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED';

export type Database = {
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
          tc_kimlik_encrypted: string | null;
          passport_encrypted: string | null;
          phone: string | null;
          email: string | null;
          address: string | null;
          nationality: string | null;
          consent_given_at: string | null;
          consent_version: string | null;
          created_at: string;
        };
        // NOTE: tc_kimlik_encrypted and passport_encrypted are intentionally
        // omitted from Insert/Update — use the create_guest / update_guest RPCs
        // which handle encryption server-side.
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
      cash_accounts: {
        Row: {
          id: string;
          property_id: string;
          name: string;
          account_type: AccountType;
          currency: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          name: string;
          account_type: AccountType;
          currency?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          property_id?: string;
          name?: string;
          account_type?: AccountType;
          currency?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      ledger_entries: {
        Row: {
          id: string;
          guest_id: string;
          reservation_id: string | null;
          type: LedgerEntryType;
          amount: number;
          currency: string;
          note: string | null;
          created_by: string | null;
          created_at: string;
          payment_collection_id: string | null;
        };
        Insert: {
          id?: string;
          guest_id: string;
          reservation_id?: string | null;
          type: LedgerEntryType;
          amount: number;
          currency?: string;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
          payment_collection_id?: string | null;
        };
        Update: {
          // ledger_entries are append-only by RLS — no UPDATE/DELETE policies.
          // Shape here is for type-completeness only.
          id?: string;
          guest_id?: string;
          reservation_id?: string | null;
          type?: LedgerEntryType;
          amount?: number;
          currency?: string;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
          payment_collection_id?: string | null;
        };
        Relationships: [];
      };
      housekeeping_issues: {
        Row: {
          id: string;
          task_id: string | null;
          property_id: string;
          unit_id: string;
          description: string;
          photo_paths: string[];
          status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
          reported_by: string | null;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          task_id?: string | null;
          property_id: string;
          unit_id: string;
          description: string;
          photo_paths?: string[];
          status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
          reported_by?: string | null;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          task_id?: string | null;
          property_id?: string;
          unit_id?: string;
          description?: string;
          photo_paths?: string[];
          status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
          reported_by?: string | null;
          created_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [];
      };
      housekeeping_tasks: {
        Row: {
          id: string;
          property_id: string;
          unit_id: string;
          status: HousekeepingStatus;
          notes: string | null;
          updated_by: string | null;
          updated_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          unit_id: string;
          status: HousekeepingStatus;
          notes?: string | null;
          updated_by?: string | null;
          updated_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          property_id?: string;
          unit_id?: string;
          status?: HousekeepingStatus;
          notes?: string | null;
          updated_by?: string | null;
          updated_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      message_templates: {
        Row: {
          id: string;
          name: string;
          content: string;
          is_default: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          content: string;
          is_default?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          content?: string;
          is_default?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      staff_advances: {
        Row: {
          id: string;
          user_id: string;
          amount: number;
          note: string | null;
          given_at: string;
          created_by: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          amount: number;
          note?: string | null;
          given_at?: string;
          created_by: string;
        };
        Update: {
          // Append-only by convention; UI doesn't expose update/delete.
          id?: string;
          user_id?: string;
          amount?: number;
          note?: string | null;
          given_at?: string;
          created_by?: string;
        };
        Relationships: [];
      };
      expenses: {
        Row: {
          id: string;
          property_id: string;
          category: string;
          amount: number;
          description: string | null;
          expense_date: string; // DATE column → "YYYY-MM-DD"
          is_recurring: boolean;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          property_id: string;
          category: string;
          amount: number;
          description?: string | null;
          expense_date: string;
          is_recurring?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          property_id?: string;
          category?: string;
          amount?: number;
          description?: string | null;
          expense_date?: string;
          is_recurring?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      payment_collections: {
        Row: {
          id: string;
          reservation_id: string;
          property_id: string;
          collected_by_user_id: string;
          amount: number;
          method: PaymentMethod;
          receipt_photo_path: string | null;
          status: PaymentStatus;
          confirmed_by: string | null;
          confirmed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          reservation_id: string;
          property_id: string;
          collected_by_user_id: string;
          amount: number;
          method: PaymentMethod;
          receipt_photo_path?: string | null;
          status?: PaymentStatus;
          confirmed_by?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          reservation_id?: string;
          property_id?: string;
          collected_by_user_id?: string;
          amount?: number;
          method?: PaymentMethod;
          receipt_photo_path?: string | null;
          status?: PaymentStatus;
          confirmed_by?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      cash_transactions: {
        Row: {
          id: string;
          cash_account_id: string;
          amount: number;
          direction: TxDirection;
          description: string | null;
          ref_type: string | null;
          ref_id: string | null;
          created_by: string | null;
          created_at: string;
          payment_collection_id: string | null;
        };
        Insert: {
          id?: string;
          cash_account_id: string;
          amount: number;
          direction: TxDirection;
          description?: string | null;
          ref_type?: string | null;
          ref_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          payment_collection_id?: string | null;
        };
        Update: {
          // cash_transactions are append-only by RLS — no UPDATE policy exists,
          // so this shape is only here for type-completeness.
          id?: string;
          cash_account_id?: string;
          amount?: number;
          direction?: TxDirection;
          description?: string | null;
          ref_type?: string | null;
          ref_id?: string | null;
          created_by?: string | null;
          created_at?: string;
          payment_collection_id?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_guest: {
        Args: {
          _full_name: string;
          _tc_kimlik?: string | null;
          _passport?: string | null;
          _phone?: string | null;
          _email?: string | null;
          _address?: string | null;
          _nationality?: string | null;
        };
        Returns: {
          id: string;
          full_name: string;
          tc_kimlik_encrypted: string | null;
          passport_encrypted: string | null;
          phone: string | null;
          email: string | null;
          address: string | null;
          nationality: string | null;
          consent_given_at: string | null;
          consent_version: string | null;
          created_at: string;
        };
      };
      update_guest: {
        Args: {
          _id: string;
          _full_name: string;
          _tc_kimlik?: string | null;
          _passport?: string | null;
          _phone?: string | null;
          _email?: string | null;
          _address?: string | null;
          _nationality?: string | null;
        };
        Returns: {
          id: string;
          full_name: string;
          tc_kimlik_encrypted: string | null;
          passport_encrypted: string | null;
          phone: string | null;
          email: string | null;
          address: string | null;
          nationality: string | null;
          consent_given_at: string | null;
          consent_version: string | null;
          created_at: string;
        };
      };
      get_guest_decrypted: {
        Args: { _id: string };
        Returns: {
          id: string;
          full_name: string;
          tc_kimlik: string | null;
          passport: string | null;
          phone: string | null;
          email: string | null;
          address: string | null;
          nationality: string | null;
          consent_given_at: string | null;
          consent_version: string | null;
          created_at: string;
        }[];
      };
      collect_payment: {
        Args: {
          _reservation_id: string;
          _amount: number;
          _method: PaymentMethod;
          _cash_account_id?: string | null;
          _note?: string | null;
        };
        Returns: string; // payment_collections.id
      };
      confirm_payment: {
        Args: { _payment_id: string };
        Returns: Database['public']['Tables']['payment_collections']['Row'];
      };
      dispute_payment: {
        Args: { _payment_id: string };
        Returns: Database['public']['Tables']['payment_collections']['Row'];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// Convenience exports — handy to import where Row/RPC return shapes are referenced
export type GuestRow = Database['public']['Tables']['guests']['Row'];
export type DecryptedGuest = Database['public']['Functions']['get_guest_decrypted']['Returns'][number];
