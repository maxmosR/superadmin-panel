import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// ---------------------------------------------------------------------------
// PUT /api/businesses/order-settings — a restaurant's order email and payment
// methods. Body: { business_id, order_notification_email?: string | null,
// payment_methods?: { card: boolean, cash: boolean } }. One SQL call,
// set_order_settings, as the operator (re-checked there).
// ---------------------------------------------------------------------------
export async function PUT(req: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (typeof b.business_id !== "string" || !UUID_RE.test(b.business_id)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 })
  }

  let email: string | null = null
  if (b.order_notification_email !== undefined) {
    if (b.order_notification_email === null || b.order_notification_email === "") email = ""
    else if (typeof b.order_notification_email === "string" && EMAIL_RE.test(b.order_notification_email.trim())) {
      email = b.order_notification_email.trim()
    } else return NextResponse.json({ error: "invalid_email" }, { status: 400 })
  }

  let methods: { card: boolean; cash: boolean } | null = null
  if (b.payment_methods !== undefined) {
    const pm = b.payment_methods as Record<string, unknown> | null
    if (!pm || typeof pm.card !== "boolean" || typeof pm.cash !== "boolean" || (!pm.card && !pm.cash)) {
      return NextResponse.json({ error: "invalid_payment_methods" }, { status: 400 })
    }
    methods = { card: pm.card, cash: pm.cash }
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("set_order_settings", {
    p_business_id: b.business_id,
    p_actor_id: guard.admin.userId,
    p_actor_kind: "operator",
    p_order_email: email,
    p_payment_methods: methods,
  })
  if (error) {
    if (error.message === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 })
    if (error.message === "invalid_payload" || error.code === "23514") {
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 })
    }
    if (error.message === "forbidden") return NextResponse.json({ error: "not_operator" }, { status: 403 })
    console.error(JSON.stringify({ event: "order_settings_failed", code: error.code ?? null }))
    return NextResponse.json({ error: "save_failed" }, { status: 500 })
  }
  return NextResponse.json(data)
}
