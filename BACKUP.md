# HomeGuru PMS — Backup Guide (simple)

A plain-language reference for the database backup. Keep it; future-you will thank you.

Same setup as PilotGarage: the backup job lives **inside a private backup repo** and writes a `backup.sql` into itself every night.

---

## What it is

- A GitHub Action inside the private repo **`Galleriaun/homeguru-backups`** dumps the whole database **every night** (02:30 UTC = 05:30 Istanbul).
- The backup is a **plain `backup.sql` file** — readable in any text editor.
- The file is **overwritten each night**, and **git history keeps every past night**. Nothing expires.
- No personal access token is involved: a repo's own workflow commits to itself with the built-in `GITHUB_TOKEN`, so there is nothing to renew.

**Where to see backups:** the `homeguru-backups` repo → `backup.sql`. Click **History** for any earlier night.

**Run one manually anytime:** that repo → Actions → Database backup → **Run workflow**.

> **Why a private repo?** The dump holds guest names, phones, emails and addresses in plaintext. The code repo (`homeguru-psm`) is **public** — the dump can never live there. `homeguru-backups` staying private is now the entire security boundary; if it is ever switched to public, treat it as a KVKK breach and switch it back at once.

---

## First-time setup (once, ~5 minutes)

1. **Create the repo.** GitHub → New repository → name `homeguru-backups`, visibility **Private**. A README is optional — the workflow handles a completely empty repo.

2. **Add one secret** in *that* repo → Settings → Secrets and variables → Actions → New repository secret:

   | Secret | Value |
   |---|---|
   | `SUPABASE_DB_URL` | Supabase **Session pooler** URI (port 5432) with the DB password |

   Get it from: Supabase dashboard → Project Settings → Database → Connection string → **Session pooler** (URI tab). It looks like `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. Replace `<password>` with the real one; URL-encode any `@ : / ?` characters in it.
   **Must be the Session pooler (5432)** — GitHub runners are IPv4-only while the direct connection is IPv6-only, and the Transaction pooler (6543) cannot run `pg_dump`.

3. **Add the workflow.** In `homeguru-backups` → Add file → Create new file → path `.github/workflows/backup.yml` → paste the file from [the section below](#the-workflow-file) → Commit.

4. **Run it once** (Actions → Database backup → Run workflow) and confirm `backup.sql` appears in the repo.

5. **Old system (already removed).** The `backup.yml` that used to run in `homeguru-psm` has been deleted:
   - nothing runs there anymore;
   - keep the `BACKUP_GPG_PASSPHRASE` secret for **30 more days** — it is the only way to open the old artifacts — then delete it too.

---

## The workflow file

Paste this into `homeguru-backups` as `.github/workflows/backup.yml`:

```yaml
name: Database backup

# Nightly logical backup of the HomeGuru PMS Supabase database.
#
# This workflow lives INSIDE the private backup repo and commits the dump to
# itself, so the built-in GITHUB_TOKEN is enough — no personal access token to
# create, and nothing that expires and silently stops the backups.
#
# The dump is PLAINTEXT and contains guest PII (names, phones, emails,
# addresses) plus the encrypted TC/passport columns. THIS REPO MUST STAY
# PRIVATE — that is the entire security boundary. If it is ever made public,
# treat it as a KVKK breach and make it private again immediately.

on:
  schedule:
    - cron: '30 2 * * *'   # daily at 02:30 UTC (05:30 Istanbul, low activity)
  workflow_dispatch:

permissions:
  contents: write          # commit backup.sql back into this repo

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Dump database (plain SQL)
        run: |
          docker run --rm \
            -e PGCONN="$SUPABASE_DB_URL" \
            postgres:17-alpine \
            sh -c 'pg_dump "$PGCONN" --format=plain --no-owner --no-privileges' > backup.sql
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}

      # A truncated or empty dump must never overwrite the last good one. Both
      # checks earn their keep: pg_dump can exit 0 having written only part of
      # the file if the connection drops, and the trailer line is written last.
      - name: Verify the dump is complete
        run: |
          bytes=$(wc -c < backup.sql)
          echo "dump size: $bytes bytes"
          if [ "$bytes" -lt 10000 ]; then
            echo "::error::dump is only $bytes bytes — refusing to overwrite the last good backup"
            exit 1
          fi
          if ! grep -q 'PostgreSQL database dump complete' backup.sql; then
            echo "::error::dump has no completion marker — it is truncated"
            exit 1
          fi

      - name: Commit tonight's backup
        run: |
          git config user.name  'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          git add backup.sql
          # Byte-identical dump (a completely quiet day) is a success, not a failure.
          if git diff --cached --quiet; then
            echo "no changes since the last backup"
            exit 0
          fi
          git commit -m "HomeGuru backup $(date -u +'%Y-%m-%d %H:%M UTC')"
          # Anything committed to this repo while the dump was running makes this push
          # stale — editing this very workflow in the web UI does exactly that. Rebase
          # onto whatever landed and retry instead of failing the backup. "-X theirs"
          # keeps THIS run's dump if the other side also touched backup.sql: during a
          # rebase the commit being replayed (ours) is the "theirs" side.
          for attempt in 1 2 3; do
            if git push origin HEAD:main; then
              echo "pushed on attempt $attempt"
              exit 0
            fi
            echo "push rejected — rebasing onto origin/main and retrying"
            git pull --rebase -X theirs origin main
          done
          echo "::error::could not push after 3 attempts"
          exit 1
```

---

## If a backup ever fails (red ❌ in Actions)

Open the failed step and match the message:

- **"empty connection string" / socket error** → `SUPABASE_DB_URL` is missing or misnamed **in the backups repo** (secrets are per-repo; the one in `homeguru-psm` does not carry over).
- **host/timeout error** → wrong connection: must be **Session pooler, port 5432** (not Direct, not Transaction pooler 6543).
- **"password authentication failed"** → DB password wrong, or a special character needs URL-encoding.
- **"dump is only N bytes" / "no completion marker"** → the dump came out incomplete and was **refused on purpose**; the previous good backup is untouched. Re-run.
- **403 on push** → the workflow is missing `permissions: contents: write`.

Fix, then re-run the workflow.

---

## How to read or restore a backup

### Just look at it
Open `backup.sql` in `homeguru-backups`. It is ordinary SQL text. For an older night: **History** → pick a commit → **View file**.

### Restore into a database
Download the `backup.sql` you want, then (Windows + PowerShell + Docker):

```powershell
cd "$env:USERPROFILE\Downloads"
docker run --rm -i -e PGCONN="postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres" -v ${PWD}:/work -w /work postgres:17-alpine sh -c 'psql "$PGCONN" -v ON_ERROR_STOP=1 -f backup.sql'
```

> ⚠️ Restore onto a **fresh/empty project**, not your live one. The dump recreates objects that already exist, so against a populated database it errors out partway.

Staff logins live in Supabase's `auth` schema (not in this dump) — recreate the staff accounts manually after restoring to a fresh project.

### Old backups (before this change)
Backups made before the switch are GPG-encrypted `.dump` artifacts under `homeguru-psm` → Actions → Database backup → Artifacts (30-day life). Those need `gpg -d` and `pg_restore`, not `psql`, and the `BACKUP_GPG_PASSPHRASE` value.

---

## Keeping the backup repo small

Each night commits only the *difference* from the previous night, so growth is slow. If after a few years it feels large, delete the repo and let a fresh one take over — you lose old history, not the current backup.

---

## The easy alternative

Upgrade to **Supabase Pro (~$25/mo)** → managed daily backups and one-click restore from the dashboard. Then delete the backup repo entirely.

---

## Quick reminders

- Backups run automatically — no daily effort, and nothing to renew.
- **`homeguru-backups` must stay private.** That is the whole security boundary.
- Test a restore **once before going live** — a backup you have never restored is a guess.
