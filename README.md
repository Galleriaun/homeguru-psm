# HomeGuru PMS

Property Management System for HomeGuru — a multi-property short-term rental operation supporting unlimited hotels (with rooms) and standalone apartments.

> *"Forget the hotel, be our guest."*

## Stack

- **Frontend:** Vite + React 18 + TypeScript + Tailwind CSS
- **PWA:** `vite-plugin-pwa` (iOS + Android installable)
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions + Realtime)
- **Hosting:** GitHub Pages (frontend) + Supabase EU/Frankfurt (backend)

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — canonical design doc (data model, RBAC, compliance, phased plan)
- [SETUP.md](SETUP.md) — step-by-step initial setup (Supabase project, migrations, GitHub secrets, deploy)

## Quick start (local dev)

```bash
cp .env.example .env.local
# Fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY from your Supabase project

npm install
npm run dev    # → http://localhost:5173
```

You must complete the Supabase setup (see [SETUP.md](SETUP.md)) before the app will actually work — without a backend, login will fail.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint check |
| `npm run typecheck` | TypeScript check (no emit) |
| `npm run format` | Prettier rewrite |

## Project layout

```
homeguru-pms/
├── .github/workflows/
│   ├── deploy.yml          # CI build + deploy to GitHub Pages
│   └── keepalive.yml       # Pings Supabase every 6 days to prevent auto-pause
├── public/icons/           # PWA icons (add 192/512/maskable + apple-touch-180)
├── src/
│   ├── main.tsx            # React entry; wires BrowserRouter with base path
│   ├── App.tsx             # Routes + AuthProvider
│   ├── index.css           # Tailwind base
│   ├── lib/
│   │   ├── supabase.ts     # Singleton client
│   │   ├── rbac.ts         # Client-side permission helpers
│   │   └── utils.ts        # cn(), formatTRY(), formatDate()
│   ├── hooks/useAuth.ts    # AuthProvider + useAuth() hook
│   ├── components/
│   │   ├── Layout.tsx
│   │   └── ProtectedRoute.tsx
│   ├── pages/              # Route-level pages
│   └── types/database.ts   # Type-safe Supabase shape (regenerate after schema changes)
├── supabase/migrations/
│   ├── 001_schema.sql      # Tables + indexes + EXCLUDE constraint
│   ├── 002_functions.sql   # auth_role(), encryption, triggers
│   ├── 003_rls.sql         # Row-level security policies
│   ├── 004_cron.sql        # pg_cron jobs (nightly auto-debit)
│   └── 005_seed.sql        # Sample data + admin user template
├── ARCHITECTURE.md
├── SETUP.md
└── README.md
```

## What's done (Sprint 0)

- ✅ Project scaffold (Vite + React + TS + Tailwind + PWA)
- ✅ Supabase client wired with env vars + type-safe `Database` shape
- ✅ Auth provider, login page, protected routes
- ✅ Layout with role badge + sign out
- ✅ Database schema with double-booking prevention (EXCLUDE constraint)
- ✅ Row-level security covering all tenanted tables
- ✅ Helper functions (encryption, balance computation, single-unit-apartment trigger)
- ✅ Nightly auto-debit cron at 00:05 Europe/Istanbul
- ✅ GitHub Actions: deploy + Supabase keepalive

## What's next (Sprint 1)

Reservations MVP — FullCalendar Gantt view, quick reservation form, availability search, KVKK encryption hooks, smart alternatives.

## License

Private. © HomeGuru.
