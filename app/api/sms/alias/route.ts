import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { forwardToSmsAlias } from "@/lib/sms-edge"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = new Set(["create", "refresh", "patch", "delete", "remove"])

// ---------------------------------------------------------------------------
// POST /api/sms/alias — create / refresh / patch / delete / remove a restaurant's SMS
// sender alias. Body: { action, business_id, alias_id?, registration?, patch? }.
//
// The OpenAPI.com call happens in the Edge Function `operator-sms-alias` (the
// OpenAPI token lives only in Edge secrets). This route forwards the
// operator's own session token; the function checks platform_admins again.
// No service-role client here. Logs the action and status only (never the PEC).
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (
    !body ||
    typeof body.action !== "string" ||
    !ACTIONS.has(body.action) ||
    typeof body.business_id !== "string" ||
    !UUID_RE.test(body.business_id) ||
    (body.action !== "create" && (typeof body.alias_id !== "string" || !UUID_RE.test(body.alias_id)))
  ) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 })
  }

  return forwardToSmsAlias({
    action: body.action,
    business_id: body.business_id,
    alias_id: body.alias_id,
    registration: body.registration,
    patch: body.patch,
  })
}
