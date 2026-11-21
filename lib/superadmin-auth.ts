import { getSupabaseClient } from "@/lib/supabase-server"
import { resolveOperator, type OperatorLookup } from "@/lib/operator-status"

export type { OperatorLookup, PlatformAdmin } from "@/lib/operator-status"

/**
 * Resolve the current request's caller (SSR cookie session) against Supabase
 * Auth and platform_admins. Only an active operator whose session is AAL2
 * (signed in with their TOTP second factor) is `operator`; an operator still
 * on AAL1 is `mfa_required`. See lib/operator-status.ts. Server-only.
 */
export async function lookupOperator(): Promise<OperatorLookup> {
  return resolveOperator(await getSupabaseClient())
}
