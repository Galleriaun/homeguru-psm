-- =============================================================================
-- HomeGuru PMS — Seed migration 005
-- =============================================================================
-- Initial data for development. DO NOT run on production without editing.
--
-- This seed does NOT create auth users (those must be created via Supabase
-- dashboard → Authentication → Add user). Once a user is created, link it
-- here by updating <YOUR_AUTH_USER_UUID> below.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Set the encryption key in Supabase Vault (one-time)
--    Do this manually in the SQL editor — never commit the actual key:
--
--    SELECT vault.create_secret('replace-with-a-strong-key', 'pms_encryption_key');
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 2) Sample properties (one HOTEL, one APARTMENT)
-- -----------------------------------------------------------------------------
INSERT INTO properties (name, type, address) VALUES
  ('Alsancak Otel',          'HOTEL',     'Alsancak, İzmir'),
  ('Karşıyaka 1+1 Daire 3',  'APARTMENT', 'Karşıyaka, İzmir');

-- -----------------------------------------------------------------------------
-- 3) Sample units for the hotel + the single apartment unit
-- -----------------------------------------------------------------------------
INSERT INTO units (property_id, name, room_type, capacity, base_price)
SELECT id, 'Oda 101', 'ROOM', 2, 1500 FROM properties WHERE name = 'Alsancak Otel'
UNION ALL
SELECT id, 'Oda 102', 'ROOM', 2, 1500 FROM properties WHERE name = 'Alsancak Otel'
UNION ALL
SELECT id, 'Suite 301', 'SUITE', 3, 2800 FROM properties WHERE name = 'Alsancak Otel'
UNION ALL
SELECT id, 'Daire', '1+1', 4, 2200 FROM properties WHERE name = 'Karşıyaka 1+1 Daire 3';

-- -----------------------------------------------------------------------------
-- 4) Cash accounts per property
-- -----------------------------------------------------------------------------
INSERT INTO cash_accounts (property_id, name, account_type)
SELECT id, 'Nakit Kasa', 'CASH' FROM properties
UNION ALL
SELECT id, 'Banka', 'BANK' FROM properties
UNION ALL
SELECT id, 'Kredi Kartı', 'CARD' FROM properties;

-- -----------------------------------------------------------------------------
-- 5) WhatsApp Phase 1 default message template
-- -----------------------------------------------------------------------------
INSERT INTO message_templates (name, content, is_default) VALUES (
  'reservation-info',
  'Merhabalar, {checkin}-{checkout} tarihleri için {property} {unit} dairemiz müsaittir. ' ||
  'Daire görsellerimize buradan ulaşabilirsiniz: {katalog_link}. ' ||
  'Forget the hotel, be our guest ✨',
  true
);

-- -----------------------------------------------------------------------------
-- 6) Linking your initial admin user
-- -----------------------------------------------------------------------------
-- Steps:
--   a. In Supabase dashboard → Authentication → Users → Add user (email + password)
--   b. Copy the new user's UUID
--   c. Replace '00000000-0000-0000-0000-000000000000' below and run:
--
-- INSERT INTO staff_profiles (user_id, full_name, role, property_id)
-- VALUES ('00000000-0000-0000-0000-000000000000', 'Patron', 'SUPER_ADMIN', NULL);
