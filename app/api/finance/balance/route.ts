// BirraOra's platform Stripe balance in EUR (operator only, read only).
//   GET → { available_cents, pending_cents, upcoming: [{ date, amount_cents }], upcoming_partial, as_of }
// Forwards to the operator-stripe-balance Edge Function with the operator's
// own session JWT: the console holds no Stripe key and never uses the
// service-role client here. Logs the status only.
import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { getSupabaseClient } from "@/lib/supabase-server"
import { normalisePlatformBalance } from "@/lib/finance"

export const dynamic = "force-dynamic"

export async function GET() {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const supabase = await getSupabaseClient()
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 })

  let res: Response
  try {
    res = await fetch(`${url}/functions/v1/operator-stripe-balance`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: anon },
      body: "{}",
      cache: "no-store",
    })
  } catch {
    return NextResponse.json({ error: "payment_gateway_unavailable" }, { status: 503 })
  }
  // Not deployed on this project yet.
  if (res.status === 404) return NextResponse.json({ error: "balance_unavailable" }, { status: 503 })
  const payload = (await res.json().catch(() => ({ error: "server_error" }))) as Record<string, unknown>
  if (!res.ok) {
    console.error(JSON.stringify({ event: "stripe_balance_failed", status: res.status, error: typeof payload.error === "string" ? payload.error : null }))
    return NextResponse.json({ error: typeof payload.error === "string" ? payload.error : "lookup_failed" }, { status: res.status })
  }
  return NextResponse.json(normalisePlatformBalance(payload))
}
