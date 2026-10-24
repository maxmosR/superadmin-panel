import { NextResponse } from "next/server"
import { lookupOperator, type PlatformAdmin } from "@/lib/superadmin-auth"

export type RequireOperatorResult =
  | { admin: PlatformAdmin; response?: undefined }
  | { admin?: undefined; response: NextResponse }

/**
 * The one operator guard for every route handler in this console.
 *
 * Call it first, before reading the body and before creating any service-role
 * client. It answers on its own, independent of `proxy.ts`:
 * - no session                     → 401 { error: "unauthenticated" }
 * - signed in, not an operator     → 403 { error: "not_operator" }
 *
 * Usage:
 *   const guard = await requireOperator()
 *   if (guard.response) return guard.response
 *   // guard.admin is the operator
 */
export async function requireOperator(): Promise<RequireOperatorResult> {
  const result = await lookupOperator()
  switch (result.status) {
    case "operator":
      return { admin: result.admin }
    case "unauthenticated":
      return { response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) }
    default:
      return { response: NextResponse.json({ error: "not_operator" }, { status: 403 }) }
  }
}
