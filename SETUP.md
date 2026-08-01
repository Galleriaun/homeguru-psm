# Setup — HomeGuru PMS

Step-by-step first-time setup. Goes from "fresh clone" to "logged into the running app."

---

## 1. Create the Supabase project (5 min)

1. Go to [supabase.com](https://supabase.com) → sign in with GitHub
2. **New project**
   - Name: `homeguru-pms` (or whatever you like)
   - Database password: generate a strong one, save it in a password manager
   - **Region: Frankfurt (EU Central)** — KVKK-friendly
   - Plan: Free
3. Wait ~2 minutes for provisioning
4. **Settings → API** — copy and keep handy:
   - `Project URL` (looks like `https://abcd1234.supabase.co`)
   - `Publishable key` (starts with `sb_publishable_...`)
5. **Settings → Auth → Providers** → make sure **Email** is on and **Confirm email** is OFF for now (faster dev). Disable signups (top of Auth → URL Configuration page) so only admins can create users.

---

## 2. Enable required extensions

**Database → Extensions** — enable these (they're free, all on standard list):

- `pgcrypto`   — sensitive-field encryption
- `btree_gist` — required for the reservation EXCLUDE constraint
- `pg_cron`    — scheduled jobs (nightly auto-debit)

---

## 3. Run the migrations (in order)

**SQL Editor → New query** → paste and run each file **in numeric order**:

1. `supabase/migrations/001_schema.sql`
2. `supabase/migrations/002_functions.sql`
3. `supabase/migrations/003_rls.sql`
4. `supabase/migrations/004_cron.sql`
5. `supabase/migrations/005_seed.sql` (optional sample data)

**⚠️ Order matters:** `003_rls.sql` references functions defined in `002_functions.sql`. Run them in the numbered order.

---

## 4. Set the encryption key

**SQL Editor → New query** — set a strong key for TC/passport encryption:

```sql
SELECT vault.create_secret('replace-with-a-strong-random-string-32+chars', 'pms_encryption_key');
```

⚠️ **Save this key somewhere safe.** If you lose it, encrypted data is unrecoverable.

---

## 5. Create your admin user

1. **Authentication → Users → Add user**
   - Email: your address
   - Password: a strong one
   - Auto Confirm User: ✅ ON
2. **Copy the new user's UUID** (shown in the Users list)
3. **SQL Editor** → link to a staff profile:

   ```sql
   INSERT INTO staff_profiles (user_id, full_name, role, property_id)
   VALUES (
     '<paste-your-user-uuid-here>',
     'Patron',
     'SUPER_ADMIN',
     NULL
   );
   ```

---

## 6. Local dev

```bash
cd homeguru-pms
cp .env.example .env.local
# Edit .env.local with your VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY

npm install
npm run dev
```

Open http://localhost:5173 → log in with the admin user → you should land on the dashboard.

---

## 7. Push to GitHub

```bash
git init
git branch -M main
git add .
git commit -m "Sprint 0: scaffold"
gh repo create homeguru-pms --private --source=. --push
```

(or use the GitHub UI to create a private repo and push manually)

---

## 8. Configure GitHub repo for deployment

In your GitHub repo:

1. **Settings → Pages → Source = GitHub Actions** (one-time setup)
2. **Settings → Secrets and variables → Actions** → New repository secret for each:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://abcd1234.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |

3. Push to `main` (or click **Run workflow** on `Deploy to GitHub Pages`)
4. Wait ~2 min — the Action will build and deploy
5. Find the URL at **Settings → Pages** → typically `https://<user>.github.io/homeguru-pms/`

---

## 8a. Activate the send-push shared secret (security)

`send-push` previously accepted any valid project Bearer token (including the
public anon key and any logged-in user's JWT), so a malicious insider could forge
notifications. Migration 130 + the updated function close that with a shared
secret. The rollout is **non-breaking and opt-in** — nothing changes until you
set both halves below. Do it in this order (Vault first) so there is no gap:

1. Pick a strong random value, e.g.:
   ```bash
   openssl rand -hex 32
   ```
2. **Vault secret** (so the DB pipeline sends it) — in the Supabase SQL editor:
   ```sql
   select vault.create_secret('<the-random-value>', 'push_secret');
   ```
3. **Function secret** (so the Edge Function enforces it) — same value:
   ```bash
   supabase secrets set PUSH_SECRET=<the-random-value>
   ```
4. Apply migration `130_send_push_shared_secret.sql`, then redeploy the function:
   ```bash
   supabase functions deploy send-push
   ```

Verify: notifications still arrive (e.g. create an UNCONFIRMED payment). A raw
`curl` to the function URL with only a Bearer token now returns **403**; the DB
triggers, which attach `x-push-secret` from Vault, still succeed. If either half
is missing the code degrades to the old behavior, so a half-finished rollout
won't drop pushes — it just won't be enforced yet.

---

## 9. Verify the keepalive workflow

After the first deploy, manually run `Supabase keepalive` once from the Actions tab to verify the secrets work. It should output a JSON array (possibly empty) and finish in seconds. After that, it runs automatically every 6 days.

---

## 10. Database backup & restore

The free tier has **no automated backups**. This stays a launch-blocker until
the project moves to Supabase Pro (managed daily backups).

The backup job does **not** live in this repo. It lives inside the private repo
**`Galleriaun/homeguru-backups`** and commits a nightly plain-SQL `pg_dump`
(`backup.sql`) into itself — the same arrangement PilotGarage uses. A repo's own
workflow can push to itself with the built-in `GITHUB_TOKEN`, so there is no
personal access token to create or renew.

**Setup, the workflow file to paste, failure messages and the restore
procedure all live in [BACKUP.md](BACKUP.md).** In short: create the private
repo, add one `SUPABASE_DB_URL` secret *to that repo*, paste the workflow, run
it once.

> **The privacy of `homeguru-backups` is the entire security boundary.** The
> dump is plaintext and holds guest PII, so it may never land in this public
> repo. If that repo is ever made public, treat it as a KVKK breach and make it
> private again before the next nightly run.
>
> The workflow refuses to commit a dump under 10 000 bytes or one missing
> pg_dump's completion marker, so a half-finished dump can never overwrite the
> last good backup.

### Leftovers from the old system

This repo used to run its own `.github/workflows/backup.yml` (daily
GPG-encrypted `pg_dump` kept as a 30-day Actions artifact). **It has been
deleted** — the backup job now lives only in the backup repo.

Two secrets remain here under **Settings → Secrets and variables → Actions**
and are no longer read by anything:

- `BACKUP_GPG_PASSPHRASE` — keep it for **30 days** from the last old run: it is
  the only way to open the artifacts still sitting under Actions. Then delete.
- `SUPABASE_DB_URL` — safe to delete once the new backup job is running (it
  needs its own copy of this secret, in the backup repo).

> Backups made **before** this change are GPG-encrypted `.dump` artifacts under
> Actions. Keep `BACKUP_GPG_PASSPHRASE` in your password manager until the last
> of them expires (30 days), then delete the secret. Those restore with
> `gpg -d` + `pg_restore`, not `psql`.

---

## 11. PWA icons (before going live)

Generate icons and drop them in `public/icons/`:

- `192.png` — 192×192
- `512.png` — 512×512
- `maskable-512.png` — 512×512 maskable
- `apple-touch-180.png` — 180×180 for iOS home screen

Tools: [maskable.app](https://maskable.app/editor), [realfavicongenerator.net](https://realfavicongenerator.net/).

---

## Pre-launch checklist (do NOT skip)

See [ARCHITECTURE.md § 18](ARCHITECTURE.md#18-pre-launch-checklist-dont-skip).

Includes: KVKK lawyer review, DPA with Supabase, VERBİS registration, RLS fuzz tests, KBS submission tested against the real endpoint, encryption verified, backup/restore tested, audit log working, custom domain (optional).
