## BirraOra operator console

Platform console for the operator: it creates and manages restaurants (`businesses`, `business_domains`), owner accounts and `platform_admins`. It is a Next.js 16.4.3 App Router app (React 19) on the shared Supabase project and uses the service-role key server-side, only after the `platform_admins` check passes.

## Operator access rules

- Every API route handler checks the operator itself, as its first statement: `const guard = await requireOperator(); if (guard.response) return guard.response` (`lib/require-operator.ts`). It answers `401 {"error":"unauthenticated"}` or `403 {"error":"not_operator"}`. Never create the service-role client (`lib/supabase-admin.ts`) before that check, and never rely on `proxy.ts` for it.
- `proxy.ts` (formerly `middleware.ts`, exports `proxy`) is a convenience redirect for pages only. Pages re-check with `getPlatformAdmin()` and redirect to `/login`.
- Each new handler gets a case in `tests/operator-guard.test.ts` (401, 403, no service-role client).
- Dependencies are exact versions, one npm lockfile (`npm ci`). Don't add `^`, `~` or `latest`. Don't enable `cacheComponents` or drop the `force-dynamic` exports.

## Shared backend (Supabase)

- The only backend source is the storefront repo `../BirraOra-three-month-test`, in `supabase/`: migrations, Edge Functions, function auth (`supabase/config.toml`) and `pg_cron` jobs. This repo has no `supabase/` folder. Don't add one, and don't copy migrations or functions here.
- Backend changes reach Supabase only through the storefront repo's GitHub Actions workflow (`.github/workflows/backend.yml`). It deploys staging `tmwccwjmdmqjhicbctvm` on merge to the default branch and production `fyvqofevxeokbgomgbew` on a `v*` tag. A schema, policy or function change is a PR there, with an isolation-suite case (`tests/isolation/`). Setup and release steps are in `../BirraOra-three-month-test/docs/backend-deploy.md`.
- Never use Supabase MCP `apply_migration` or `deploy_edge_function`, `supabase db push` or `functions deploy`, or the dashboard SQL editor to change schema, policies or functions. Read-only calls (listing migrations, SELECTs, logs) are fine.
- All four repos read the same database: `../BirraOra-three-month-test`, `../admin-panel-shop`, `../superadmin-panel` and `../order_receiver`. Before changing or relying on a table, RLS policy, SQL function or Edge Function, grep all four for it.
- Never log personal data (names, emails, phones, addresses, order payloads). Log ids and counts.
