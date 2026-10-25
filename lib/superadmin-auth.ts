import { getSupabaseClient } from "@/lib/supabase-server"

export interface PlatformAdmin {
  userId: string
  email: string | null
}

/**
 * Who is calling, as far as the operator console cares:
 * - `unauthenticated`: no valid Supabase session;
 * - `not_operator`: signed in, but no active platform_admins row (or the
 *   membership lookup failed — fail closed);
 * - `operator`: an active platform admin.
 */
export type OperatorLookup =
  | { status: "unauthenticated" }
  | { status: "not_operator" }
  | { status: "operator"; admin: PlatformAdmin }

/**
 * Resolve the current request's caller against platform_admins.
 *
 * Reads the signed-in user from the SSR cookie session (`getUser()`, which
 * revalidates the JWT with Supabase Auth) and confirms they are an active row
 * in platform_admins. The `platform_admins_select_own` RLS policy lets a
 * signed-in user read their own row, so this needs only the anon key — no
 * service-role dependency (that is reserved for cross-tenant provisioning).
 * Server-only.
 */
export async function lookupOperator(): Promise<OperatorLookup> {
  const supabase = await getSupabaseClient()
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

  return {
    status: "operator",
    admin: { userId: data.user_id, email: data.email ?? user.email ?? null },
  }
}
