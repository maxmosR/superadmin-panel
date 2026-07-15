import { getSupabaseClient } from "@/lib/supabase-server"

export interface PlatformAdmin {
  userId: string
  email: string | null
}

/**
 * Resolve the current request's platform admin, if any.
 *
 * Reads the signed-in user from the SSR cookie session and confirms they are
 * an active row in platform_admins. The `platform_admins_select_own` RLS policy
 * lets a signed-in user read their own row, so this needs only the anon key —
 * no service-role dependency (that is reserved for cross-tenant provisioning).
 * Returns null when not signed in or not an admin. Server-only.
 */
export async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
  const supabase = await getSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id, email, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle()

  if (error || !data) return null

  return { userId: data.user_id, email: data.email ?? user.email ?? null }
}
