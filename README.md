# Super Admin Panel

A standalone platform-administration console, extracted from the tenant admin
app. It provisions and manages **businesses** (tenants) and their owner accounts
against a shared Supabase project.

Each business gets:

- a `businesses` row + `business_configurations` (timezone, currency, minimum
  charge, max concurrent appointments, open hours)
- an owner **auth user** and an owner `profiles` row (`role = owner`)
- one or more `business_domains` entries — the hosts the tenant app is reached
  on. The backend turns a request host into the tenant's `business_id`, which is
  why the tenant apps carry no business id in their environment at all

## What it does

| Route              | Purpose                                                        |
| ------------------ | ------------------------------------------------------------- |
| `/login`           | Platform-admin sign in (Supabase email/password)              |
| `/`                | Dashboard — list businesses, create, edit                     |
| `GET /api/me`      | Confirms the signed-in user is an active `platform_admins` row (401/403 otherwise) |
| `GET /api/businesses`   | List all businesses with domain, config and owner        |
| `POST /api/businesses`  | Provision a business + owner (atomic, rolls back on failure) |
| `PATCH /api/businesses` | Update business, config, primary domain, or reset owner password |
| `GET/POST/PATCH/DELETE /api/businesses/domains` | Manage a business' domains — add, rename, re-point, enable/disable, choose the primary |
| `/businesses/[businessId]/zones` | Delivery zones editor: center point, rings (km → €), cut lines, per-piece fee or no delivery, address tests, publish, history |
| `GET /api/zones?business_id=` | Business, draft and live zone sets (authored state + computed pieces) and version history |
| `PUT /api/zones/draft` | Save the draft (`expected_revision`); returns recomputed pieces and issues. `409 draft_changed` when another window saved first |
| `POST /api/zones/draft/discard` | Reset the draft to the live version (or delete it if nothing is live) |
| `POST /api/zones/test` | What a point pays under the draft and the live version (same SQL core as `quote_delivery`) |
| `POST /api/zones/publish` | Validate and publish the draft as a new immutable version (`422` with the issues when blocked) |
| `POST /api/zones/restore` | Copy a past version into the draft |
| `GET /api/zones/version?business_id=&version=` | One published or archived version, read-only |

Delivery fees are computed only in SQL (`quote_delivery`, migration
`20261026130000_delivery_zones.sql` in the storefront repo); the map only shows
server results. Zone writes come only from this console. Setup for the map:
add every operator console domain to the Google Maps key's HTTP referrers
(with **Maps JavaScript API** and **Places API (New)** enabled on the key), and
create a **Map ID** (Advanced Markers need one). Both env vars below are build-time.

Access is checked in three independent places, and none relies on another:

- [`proxy.ts`](proxy.ts) (Next.js 16's replacement for `middleware.ts`) refreshes
  the session and redirects non-operators on page routes to `/login`. It is a
  convenience, never the guard.
- `app/page.tsx` re-checks the operator server-side and redirects to `/login`.
- **Every API route handler checks the operator itself**, first, via
  [`requireOperator()`](lib/require-operator.ts): `401 {"error":"unauthenticated"}`
  without a session, `403 {"error":"not_operator"}` for a signed-in user with no
  active `platform_admins` row. No service-role client is created before it passes.

Provisioning uses the Supabase **service-role key** (bypasses RLS) and only runs
after that check passes. `npm test` proves each handler refuses both cases.

## Relationship to the tenant app

This console **shares the same Supabase project** as the tenant app it manages —
it writes directly into that database's `businesses`, `business_domains`,
`business_configurations`, `profiles` and `platform_admins` tables. Point
`NEXT_PUBLIC_SUPABASE_URL` / keys at that same project.

The `platform_admins` table and its RLS live in the storefront repo, the only
backend source:
`BirraOra-three-month-test/supabase/migrations/20260712184147_super_admin.sql`
(and the tenancy migrations after it). This repo holds no `supabase/` folder;
schema changes are PRs to the storefront repo and are deployed only by its
GitHub Actions workflow (see `docs/backend-deploy.md` there).

## Setup

```bash
cp .env.example .env.local   # fill in Supabase URL + keys + root domain
npm install
npm run dev                  # http://localhost:3000
```

### Seed the first super admin

1. Create an auth user in the Supabase dashboard (Authentication → Users → Add
   user, tick "Auto Confirm User").
2. Insert it into `platform_admins`:

   ```sql
   INSERT INTO public.platform_admins (user_id, email)
   SELECT id, email FROM auth.users WHERE email = 'you@example.com'
   ON CONFLICT (user_id) DO NOTHING;
   ```

## Environment

| Variable                        | Notes                                             |
| ------------------------------- | ------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Shared Supabase project URL                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (login + admin membership check via RLS) |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Server only** — provisioning; never exposed     |
| `NEXT_PUBLIC_ROOT_DOMAIN`       | Tenant app root domain, for building tenant URLs  |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY`   | Browser Maps key for the zone editor (HTTP-referrer restricted to the console's domains). Build-time |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | Map ID for Advanced Markers in the zone editor (falls back to `DEMO_MAP_ID` in development). Build-time |

## Stack

Next.js 16.4.3 (App Router, `proxy.ts`) · React 19 · Supabase (`@supabase/ssr`) ·
Tailwind CSS v4 · shadcn/ui (Radix) · TypeScript · Vitest. Node >= 20.9.

Dependencies are pinned to exact versions (no `^`, `~` or `latest`) with one npm
lockfile; install with `npm ci`. Checks: `npm run build`, `npx tsc --noEmit`,
`npm test`, `npm run lint` (flat config, `eslint .`).
