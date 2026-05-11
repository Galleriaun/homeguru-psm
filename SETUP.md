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

## 9. Verify the keepalive workflow

After the first deploy, manually run `Supabase keepalive` once from the Actions tab to verify the secrets work. It should output a JSON array (possibly empty) and finish in seconds. After that, it runs automatically every 6 days.

---

## 10. PWA icons (before going live)

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
