## BirraOra operator console

Platform console for the operator: it creates and manages restaurants (`businesses`, `business_domains`), owner accounts and `platform_admins`. It is a Next.js 16.4.3 App Router app (React 19) on the shared Supabase project and uses the service-role key server-side, only after the `platform_admins` check passes.

## Operator access rules

- Every API route handler checks the operator itself, as its first statement: `const guard = await requireOperator(); if (guard.response) return guard.response` (`lib/require-operator.ts`). It answers `401 {"error":"unauthenticated"}`, `403 {"error":"not_operator"}` or `403 {"error":"mfa_required"}`. Never create the service-role client (`lib/supabase-admin.ts`) before that check, and never rely on `proxy.ts` for it.
- `proxy.ts` (formerly `middleware.ts`, exports `proxy`) is a convenience redirect for pages only. Pages re-check with `lookupOperator()` and redirect to `/login`.
- Each new handler gets a case in `tests/operator-guard.test.ts` (401, 403, no service-role client).
- **Second factor:** an operator is only `operator` on an AAL2 session (Supabase Auth TOTP). On AAL1, `lookupOperator()` returns `mfa_required` (`hasTotp` → `/mfa/challenge`, else `/mfa/enroll`); pages redirect with `redirectPathFor()` (`lib/operator-status.ts`). Enrolment and challenge run in the browser (`components/superadmin/mfa-panel.tsx`). TOTP MFA must stay enabled in the Supabase Auth settings.
- **CSRF and headers:** `proxy.ts` refuses any non-GET/HEAD/OPTIONS request whose `Origin` isn't exactly the console's own (`CONSOLE_ORIGIN` if set, else the request origin; fallback `Sec-Fetch-Site: same-origin`) with `403 bad_origin`, and API bodies that aren't `application/json` with `415 unsupported_media_type` (`lib/csrf.ts`). It also sets the per-request nonce CSP (`lib/csp.ts`); the static security headers are in `next.config.mjs`. A new browser-side third party needs a CSP entry.
- Pages check too: `app/page.tsx` and `app/operators/page.tsx` call `lookupOperator()` themselves.
- **Roles:** owners and staff are `user_roles` rows, written only through `set_role_assignment(operatorId, 'operator', …)` (`lib/roles.ts`). It refuses to leave a restaurant without an owner (`409 last_owner`). Never write `profiles.role` or `profiles.business_id` (deprecated; `tests/phase8.test.ts` greps for it), and never set passwords: an owner is an existing identity, or one pre-created unconfirmed by phone/email, who signs in with a code.
- **Operators in admin panels:** an active operator counts as `owner` in every restaurant's admin panel (backend `staff_role_at` / `has_role_at`; the admin panel's `staffRoleAt()`), without a `user_roles` row, so they never show in Staff. The restaurant page links to its admin hosts (`adminPanelHosts()` in `lib/domains.ts`: active domains named like `admin…`, else all active ones).
- **Sign-in email:** `PUT /api/businesses/staff-email` sets the email of someone with a role at that restaurant (`auth.admin.updateUserById`, confirmed; `profiles.email` follows by trigger). It refuses an email another account uses (`409 email_taken`). It is the person's one identity, so it changes for every restaurant and the storefront.
- A restaurant's `slug` (`^[a-z0-9-]{3,40}$`, unique) is set at creation and immutable (storage folders use it). `email_from_name` and `whatsapp_number` (E.164, shown to customers who can't get an SMS code) are operator-only fields. `businesses.sms_sender_name` is a read-only mirror of the APPROVED SMS alias; never write it here.
- **SMS sender aliases** (`/sms`, `/sms/[businessId]`): one per restaurant per OpenAPI environment, Italy only. Created, refreshed, corrected (only in `PATCH_REQUIRED`) and deleted through `POST /api/sms/alias` → the `operator-sms-alias` Edge Function with the operator's own session; the console holds no OpenAPI token. Usage and the message log (`GET /api/sms`, `GET /api/sms/business`) read `sms_sender_aliases`, `sms_logs` and `sms_usage_totals` with the service role, phones masked. Without an APPROVED alias a restaurant's phone sign-in and checkout verification are blocked. Deleting an alias from a restaurant (`remove`) works in any state; the dialog lists what is deleted (our record; at OpenAPI only when Approved / Needs correction) and what is kept (sent SMS, costs).
- **OpenAPI aliases** (`/sms/openapi`): every alias on BirraOra's OpenAPI account, read live (`GET /api/sms/openapi` → `openapi_list`), linked restaurant or "not linked". Change (`PATCH`, only in Needs correction) and delete (`DELETE`, only Approved / Needs correction) go to OpenAPI through `POST /api/sms/openapi`; a linked restaurant's record follows. An alias no restaurant uses can be linked to one (`action: "link"` → `openapi_link`: our row only, nothing sent to OpenAPI; refused when already linked, not IT, or the restaurant already has a live alias and this one is live). Both SMS routes forward through `lib/sms-edge.ts`.
- **Receipts fiscal id** (`GET/PUT /api/businesses/fiscal-settings`): the restaurant's own P.IVA (11 digits, check digit) or codice fiscale (16 characters, check letter), upper-case (`lib/fiscal-id.ts`), written to `business_fiscal_settings` with the service role. Never log the value.
- **Order-receiver devices** (`/api/businesses/order-devices`): `POST` creates a one-time pairing code (`create_order_device_pairing`, 15 minutes, shown once, never logged), `GET` lists `order_devices` (never `key_hash`), `PATCH` revokes (`revoked_at`).
- The sign-in email of a platform admin is never changed through `staff-email` (`403 target_is_operator`).
- The last active operator can't be deactivated (`/api/operators`, `409 last_operator`), and nobody deactivates themselves (`409 cannot_deactivate_self`).
- **Audit:** operator (de)activation and staff sign-in email changes write `record_audit` (`personal_data_audit_log`, ids only) through `recordOperatorAudit()` (`lib/operator-audit.ts`) before the change; if the audit write fails, nothing changes (`500 audit_failed`). Role changes are audited by `set_role_assignment` itself (`user_role_events`).
- Dependencies are exact versions, one npm lockfile (`npm ci`). Don't add `^`, `~` or `latest`. Don't enable `cacheComponents` or drop the `force-dynamic` exports.

## Payments

- Each restaurant's Stripe Connect account is created from the businesses table (Payout account cell → `POST /api/businesses/payout-account` → the `operator-create-payout-account` Edge Function with the operator's own session). The console holds no Stripe key; the platform key lives only in Edge secrets. Never store per-restaurant Stripe keys.
- Order email and payment methods (card / cash on delivery, at least one) are set through `PUT /api/businesses/order-settings` (`set_order_settings` as the operator), never by writing the columns directly.

## Shared backend (Supabase)

- The only backend source is the storefront repo `../BirraOra-three-month-test`, in `supabase/`: migrations, Edge Functions, function auth (`supabase/config.toml`) and `pg_cron` jobs. This repo has no `supabase/` folder. Don't add one, and don't copy migrations or functions here.
- Backend changes reach Supabase only through the storefront repo's GitHub Actions workflow (`.github/workflows/backend.yml`). It deploys staging `tmwccwjmdmqjhicbctvm` on merge to the default branch and production `fyvqofevxeokbgomgbew` on a `v*` tag. A schema, policy or function change is a PR there, with an isolation-suite case (`tests/isolation/`). Setup and release steps are in `../BirraOra-three-month-test/docs/backend-deploy.md`.
- Never use Supabase MCP `apply_migration` or `deploy_edge_function`, `supabase db push` or `functions deploy`, or the dashboard SQL editor to change schema, policies or functions. Read-only calls (listing migrations, SELECTs, logs) are fine.
- All four repos read the same database: `../BirraOra-three-month-test`, `../admin-panel-shop`, `../superadmin-panel` and `../order_receiver`. Before changing or relying on a table, RLS policy, SQL function or Edge Function, grep all four for it.
- Never log personal data (names, emails, phones, addresses, order payloads). Log ids and counts.
- Delivery fees come only from `quote_delivery` / published zone sets; zone writes only from superadmin-panel.

## Checks

- Before pushing: `npm run lint`, `npm run typecheck`, `npm test`. `.github/workflows/ci.yml` runs the same on every PR and push to `main` (no secrets, no network).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
