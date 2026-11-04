import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { getSupabaseClient } from "@/lib/supabase-server"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = new Set(["create", "refresh", "patch", "delete"])

// ---------------------------------------------------------------------------
// POST /api/sms/alias — create / refresh / patch / delete a restaurant's SMS
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

  const supabase = await getSupabaseClient()
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 })

  const forward = {
    action: body.action,
    business_id: body.business_id,
    alias_id: body.alias_id,
    registration: body.registration,
    patch: body.patch,
  }
  let res: Response
  try {
    res = await fetch(`${url}/functions/v1/operator-sms-alias`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: anon },
      body: JSON.stringify(forward),
    })
  } catch {
    return NextResponse.json({ error: "sms_gateway_unavailable" }, { status: 503 })
  }
  const payload = await res.json().catch(() => ({ error: "server_error" }))
  console.log(JSON.stringify({ event: "sms_alias_action", action: body.action, status: res.status }))
  return NextResponse.json(payload, { status: res.status })
}
