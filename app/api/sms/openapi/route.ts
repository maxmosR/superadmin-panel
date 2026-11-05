import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { forwardToSmsAlias } from "@/lib/sms-edge"

export const dynamic = "force-dynamic"

const OPENAPI_ID_RE = /^[A-Za-z0-9_-]{1,100}$/
const ACTIONS = new Set(["get", "patch", "delete", "link"])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// The sender aliases on BirraOra's OpenAPI.com account, read and changed at
// OpenAPI itself (not our copy), through the operator-sms-alias Edge Function.
//   GET  /api/sms/openapi                 every alias in this environment, with
//                                         the restaurant it's linked to (or none)
//   POST /api/sms/openapi { action: "get" | "patch" | "delete", openapi_id, patch? }
//   POST /api/sms/openapi { action: "link", openapi_id, business_id }  an alias no
//                                         restaurant uses becomes this restaurant's
// No service-role client here.
// ---------------------------------------------------------------------------
export async function GET() {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  return forwardToSmsAlias({ action: "openapi_list" })
}

export async function POST(req: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (
    !body ||
    typeof body.action !== "string" ||
    !ACTIONS.has(body.action) ||
    typeof body.openapi_id !== "string" ||
    !OPENAPI_ID_RE.test(body.openapi_id) ||
    (body.action === "link" && (typeof body.business_id !== "string" || !UUID_RE.test(body.business_id)))
  ) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 })
  }
  return forwardToSmsAlias({
    action: `openapi_${body.action}`,
    openapi_id: body.openapi_id,
    patch: body.patch,
    business_id: body.action === "link" ? body.business_id : undefined,
  })
}
