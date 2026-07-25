-- =============================================================================
-- HomeGuru PMS — migration 130
-- Lock send-push to a shared secret only the DB pipeline knows.
-- =============================================================================
-- send-push's only auth check is that SOME Bearer token is present (its comment
-- leans on Supabase's gateway, which accepts the project's PUBLIC anon key and
-- any logged-in user's JWT). So any authenticated user — or anyone with the anon
-- key baked into the client bundle — could POST and, running as service_role
-- inside the function, forge `notifications` rows and blast Web Push with
-- attacker-chosen title/body/url (a phishing / spam vector).
--
-- Fix: a dedicated shared secret. _send_push_async attaches it as an
-- `x-push-secret` header, read from Vault; the Edge Function rejects a call whose
-- header doesn't match its PUSH_SECRET env. This is decoupled from the
-- service_role key entirely, so it sidesteps the legacy-JWT vs sb_secret_ key
-- format trap that made the old strict check fragile.
--
-- Rollout is non-breaking and opt-in (see SETUP.md §8a):
--   * This function adds the header ONLY when the Vault secret `push_secret`
--     exists; until then it behaves exactly like 053.
--   * The Edge Function enforces the header ONLY when its PUSH_SECRET env is set;
--     until then it behaves exactly like before.
--   Set BOTH to the same random value (Vault first, then redeploy the function)
--   to turn the protection on with no gap. Signature is unchanged from 053, so
--   every caller keeps working.
-- =============================================================================

CREATE OR REPLACE FUNCTION _send_push_async(
  _roles      text[],
  _title      text,
  _body       text,
  _url        text,
  _kind       text,
  _event_type text,
  _data       jsonb DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  function_url text;
  service_key  text;
  push_secret  text;
  headers      jsonb;
  request_id   bigint;
BEGIN
  SELECT decrypted_secret INTO function_url
    FROM vault.decrypted_secrets WHERE name = 'send_push_url' LIMIT 1;
  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  -- Optional during rollout; once set (and PUSH_SECRET is set on the function),
  -- it becomes the real auth boundary.
  SELECT decrypted_secret INTO push_secret
    FROM vault.decrypted_secrets WHERE name = 'push_secret' LIMIT 1;

  IF function_url IS NULL OR service_key IS NULL THEN
    RAISE NOTICE '[push] vault secrets send_push_url/service_role_key missing — skipping';
    RETURN NULL;
  END IF;

  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || service_key,
    'Content-Type', 'application/json'
  );
  IF push_secret IS NOT NULL THEN
    headers := headers || jsonb_build_object('x-push-secret', push_secret);
  END IF;

  SELECT net.http_post(
    url := function_url,
    headers := headers,
    body := jsonb_build_object(
      'roles',      _roles,
      'title',      _title,
      'body',       _body,
      'url',        _url,
      'kind',       _kind,
      'event_type', _event_type,
      'data',       COALESCE(_data, '{}'::jsonb)
    )
  ) INTO request_id;

  RETURN request_id;
END;
$$;
