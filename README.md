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
| `GET /api/me`      | Confirms the signed-in user is an active `platform_admins` row |
| `GET /api/businesses`   | List all businesses with domain, config and owner        |
| `POST /api/businesses`  | Provision a business + owner (atomic, rolls back on failure) |
| `PATCH /api/businesses` | Update business, config, primary domain, or reset owner password |
| `GET/POST/PATCH/DELETE /api/businesses/domains` | Manage a business' domains — add, rename, re-point, enable/disable, choose the primary |

Access is gated by [`middleware.ts`](middleware.ts): every page except `/login`
requires an active `platform_admins` row. Provisioning uses the Supabase
**service-role key** (bypasses RLS) and only runs after the admin check passes.

## Relationship to the tenant app

This console **shares the same Supabase project** as the tenant app it manages —
it writes directly into that database's `businesses`, `business_domains`,
`business_configurations`, `profiles` and `platform_admins` tables. Point
`NEXT_PUBLIC_SUPABASE_URL` / keys at that same project.

The `platform_admins` table and its RLS live in
[`supabase/migrations/20260712000001_super_admin.sql`](supabase/migrations/20260712000001_super_admin.sql),
included here for reference (it normally lives in / is applied from the tenant
app's migration history — do not apply it twice).

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

## Stack

Next.js 14 (App Router) · Supabase (`@supabase/ssr`) · Tailwind CSS v4 ·
shadcn/ui (Radix) · TypeScript.
