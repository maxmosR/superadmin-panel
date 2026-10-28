import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { getSupabaseClient } from "@/lib/supabase-server"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// POST /api/businesses/payout-account — create the restaurant's Stripe
// connected account. Body: { business_id }.
//
// The Stripe call happens in the Edge Function `operator-create-payout-account`
// (the platform secret key lives only in Edge secrets). This route forwards the
// operator's own session token; the function checks platform_admins again.
// No service-role client here.
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const body = (await req.json().catch(() => null)) as { business_id?: unknown } | null
  if (!body || typeof body.business_id !== "string" || !UUID_RE.test(body.business_id)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 })
  }

  const supabase = await getSupabaseClient()
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 })

  let res: Response
  try {
    res = await fetch(`${url}/functions/v1/operator-create-payout-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: anon },
      body: JSON.stringify({ business_id: body.business_id }),
    })
  } catch {
    return NextResponse.json({ error: "payment_gateway_unavailable" }, { status: 503 })
  }
  const payload = await res.json().catch(() => ({ error: "server_error" }))
  console.log(JSON.stringify({ event: "payout_account_create", status: res.status }))
  return NextResponse.json(payload, { status: res.status })
}
