// Who is calling, for every surface of the console (pages, route handlers,
// proxy.ts). Shared so the page redirects and the API guard can never
// disagree. No `next/headers` here: proxy.ts passes its own client.
import type { SupabaseClient } from "@supabase/supabase-js"

export interface PlatformAdmin {
  userId: string
  email: string | null
}

/**
 * - `unauthenticated`: no valid Supabase session;
 * - `not_operator`: signed in, but no active platform_admins row (or the
 *   membership lookup failed — fail closed);
 * - `mfa_required`: an active operator whose session is not AAL2 yet.
 *   `hasTotp` says whether they already have a verified TOTP factor
 *   (→ challenge) or must enrol one first (→ enrol);
 * - `operator`: an active platform admin signed in with a second factor.
 */
export type OperatorLookup =
  | { status: "unauthenticated" }
  | { status: "not_operator" }
  | { status: "mfa_required"; admin: PlatformAdmin; hasTotp: boolean }
  | { status: "operator"; admin: PlatformAdmin }

/**
 * Claims of a JWT, decoded without verification. Only used on a token whose
 * user Supabase Auth has just confirmed (`getUser`), and only for `aal`/`sub`.
 */
export function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
    const claims = JSON.parse(json)
    return claims && typeof claims === "object" ? (claims as Record<string, unknown>) : null
  } catch {
    return null
  }
}

type Factor = { factor_type?: string; status?: string }

export function hasVerifiedTotp(factors: Factor[] | undefined | null): boolean {
  return (factors ?? []).some((f) => f.factor_type === "totp" && f.status === "verified")
}

/**
 * Resolve the caller against Supabase Auth and platform_admins.
 *
 * `getUser()` revalidates the session's JWT with Supabase Auth (and refreshes
 * an expired one); the same session's access token then gives the assurance
 * level (`aal`), checked to belong to that same user. The
 * `platform_admins_select_own` RLS policy lets a signed-in user read their own
 * row, so the anon key is enough.
 */
export async function resolveOperator(supabase: SupabaseClient): Promise<OperatorLookup> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  // "No session" is the normal anonymous case; anything else is worth a log.
  // Log the error code/message only — never the email or user id.
  if (userError && userError.name !== "AuthSessionMissingError") {
    console.error("[superadmin] getUser failed", userError.code ?? userError.name, userError.message)
  }
  if (!user) return { status: "unauthenticated" }

  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id, email, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle()

  if (error) {
    console.error("[superadmin] platform_admins lookup failed", error.code, error.message)
    return { status: "not_operator" }
  }
  if (!data) return { status: "not_operator" }

  const admin: PlatformAdmin = { userId: data.user_id, email: data.email ?? user.email ?? null }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const claims = session?.access_token ? decodeJwtClaims(session.access_token) : null
  const aal2 = claims?.sub === user.id && claims?.aal === "aal2"
  if (!aal2) return { status: "mfa_required", admin, hasTotp: hasVerifiedTotp(user.factors) }

  return { status: "operator", admin }
}

export const MFA_ENROLL_PATH = "/mfa/enroll"
export const MFA_CHALLENGE_PATH = "/mfa/challenge"

/** Where a page sends a caller who isn't a fully signed-in operator. */
export function redirectPathFor(result: Exclude<OperatorLookup, { status: "operator" }>): string {
  if (result.status === "mfa_required") return result.hasTotp ? MFA_CHALLENGE_PATH : MFA_ENROLL_PATH
  return "/login"
}
