## BirraOra operator console

Platform console for the operator: it creates and manages restaurants (`businesses`, `business_domains`), owner accounts and `platform_admins`. It is a Next.js App Router app on the shared Supabase project and uses the service-role key server-side, only after the `platform_admins` check passes.

## Shared backend (Supabase)

- The only backend source is the storefront repo `../BirraOra-three-month-test`, in `supabase/`: migrations, Edge Functions, function auth (`supabase/config.toml`) and `pg_cron` jobs. This repo has no `supabase/` folder. Don't add one, and don't copy migrations or functions here.
- Backend changes reach Supabase only through the storefront repo's GitHub Actions workflow (`.github/workflows/backend.yml`). It deploys staging `tmwccwjmdmqjhicbctvm` on merge to the default branch and production `fyvqofevxeokbgomgbew` on a `v*` tag. A schema, policy or function change is a PR there, with an isolation-suite case (`tests/isolation/`). Setup and release steps are in `../BirraOra-three-month-test/docs/backend-deploy.md`.
- Never use Supabase MCP `apply_migration` or `deploy_edge_function`, `supabase db push` or `functions deploy`, or the dashboard SQL editor to change schema, policies or functions. Read-only calls (listing migrations, SELECTs, logs) are fine.
- All four repos read the same database: `../BirraOra-three-month-test`, `../admin-panel-shop`, `../superadmin-panel` and `../order_receiver`. Before changing or relying on a table, RLS policy, SQL function or Edge Function, grep all four for it.
- Never log personal data (names, emails, phones, addresses, order payloads). Log ids and counts.
