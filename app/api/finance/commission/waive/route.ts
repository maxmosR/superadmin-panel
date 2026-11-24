// Waive a cash order's commission (operator only).
//   POST { business_id, order_id, reason: 1–500 chars }
//     → { result: "applied" | "noop", entry_id, order_id, fee_cents_waived, cap_adjusted_cents }
// For a cash order whose cash the restaurant didn't collect: the fee is due
// on delivery either way, and only an operator takes it back. Calls
// waive_commission with the service role and this operator as the actor; the
// SQL re-checks the operator, writes the 'waiver' ledger row (operator and
// reason on it), re-charges freed cap room (cap_adjustment) and writes the
// commission_waived audit row itself, so nothing is audited here. A second
// call answers the first waiver (result "noop").
// Errors: 400 invalid_payload / invalid_order_id / invalid_reason, 404
// not_found (no fee for this order at this restaurant), 409
// invalid_transition (a card order: refunds take card fees back), 403
// not_operator, 503 finance_unavailable. Logs carry ids only, never the reason.
import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { isUuid } from "@/lib/zones/validate"
import { toInt } from "@/lib/finance"

export const dynamic = "force-dynamic"

const MISSING = new Set(["PGRST202", "42883", "PGRST205", "42P01"])
const REASON_MAX = 500

export async function POST(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (!isUuid(b.business_id)) return NextResponse.json({ error: "invalid_payload" }, { status: 400 })
  if (!isUuid(b.order_id)) return NextResponse.json({ error: "invalid_order_id" }, { status: 400 })
  const reason = typeof b.reason === "string" ? b.reason.trim() : ""
  if (!reason || reason.length > REASON_MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) {
    return NextResponse.json({ error: "invalid_reason" }, { status: 400 })
  }

  const admin = createAdminClient()

  // The order's fee must belong to the restaurant the operator is looking at.
  const { data: fee, error: feeError } = await admin
    .from("commission_entries")
    .select("id")
    .eq("order_id", b.order_id)
    .eq("business_id", b.business_id)
    .eq("kind", "fee")
    .maybeSingle()
  if (feeError) {
    if (MISSING.has(feeError.code)) return NextResponse.json({ error: "finance_unavailable" }, { status: 503 })
    console.error(JSON.stringify({ event: "commission_waive_lookup_failed", business: b.business_id, order: b.order_id, code: feeError.code ?? null }))
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  }
  if (!fee) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const { data, error } = await admin.rpc("waive_commission", {
    p_order_id: b.order_id,
    p_actor_id: guard.admin.userId,
    p_reason: reason,
  })
  if (error) {
    const m = error.message
    if (m === "forbidden") return NextResponse.json({ error: "not_operator" }, { status: 403 })
    if (m === "invalid_payload") return NextResponse.json({ error: "invalid_payload" }, { status: 400 })
    if (m === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 })
    if (m === "invalid_transition") return NextResponse.json({ error: "invalid_transition" }, { status: 409 })
    if (MISSING.has(error.code)) return NextResponse.json({ error: "finance_unavailable" }, { status: 503 })
    console.error(JSON.stringify({ event: "commission_waive_failed", business: b.business_id, order: b.order_id, code: error.code ?? null }))
    return NextResponse.json({ error: "save_failed" }, { status: 500 })
  }

  const r = (data ?? {}) as Record<string, unknown>
  const result = r.result === "noop" ? "noop" : "applied"
  const body = {
    result,
    entry_id: typeof r.entry_id === "string" ? r.entry_id : null,
    order_id: b.order_id,
    fee_cents_waived: toInt(r.fee_cents_waived),
    cap_adjusted_cents: toInt(r.cap_adjusted_cents),
  }
  console.info(
    JSON.stringify({ event: "commission_waived", operator: guard.admin.userId, business: b.business_id, order: b.order_id, entry: body.entry_id, result }),
  )
  return NextResponse.json(body)
}
