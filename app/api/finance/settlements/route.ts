// Weekly settlements (operator only).
//   GET  ?status=<status|all>&business_id=<uuid>   → { settlements: Settlement[] } newest first, max 200
//   POST { action: "pay", settlement_id, expected_version }
//        → the operator-settlement-pay Edge Function with the operator's own
//          session (approves a pending one, then transfers and pays out; the
//          Stripe key lives only in Edge secrets). Its answer is passed through.
//   POST { action: "cancel", settlement_id, expected_version, reason }
//        → settlement_cancel with the service role, as this operator.
// Logs carry ids and statuses only.
import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { getSupabaseClient } from "@/lib/supabase-server"
import { isUuid } from "@/lib/zones/validate"
import { isSettlementStatus, normaliseSettlement, SETTLEMENT_COLUMNS } from "@/lib/finance"

export const dynamic = "force-dynamic"

const MISSING = new Set(["PGRST202", "42883", "PGRST205", "42P01"])
const LIMIT = 200

export async function GET(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const q = new URL(request.url).searchParams
  const status = q.get("status")
  if (status !== null && status !== "" && status !== "all" && !isSettlementStatus(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 })
  }
  const businessId = q.get("business_id")
  if (businessId !== null && businessId !== "" && !isUuid(businessId)) {
    return NextResponse.json({ error: "invalid_business_id" }, { status: 400 })
  }

  const admin = createAdminClient()
  let query = admin.from("settlements").select(SETTLEMENT_COLUMNS)
  if (status && status !== "all") query = query.eq("status", status)
  if (businessId) query = query.eq("business_id", businessId)
  const { data, error } = await query.order("period_start", { ascending: false }).order("created_at", { ascending: false }).limit(LIMIT)
  if (error) {
    if (MISSING.has(error.code)) return NextResponse.json({ error: "finance_unavailable" }, { status: 503 })
    console.error(JSON.stringify({ event: "settlements_read_failed", code: error.code ?? null }))
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  }
  const rows = (data ?? []) as unknown as Record<string, unknown>[]

  const ids = [...new Set(rows.map((r) => String(r.business_id)))]
  const names = new Map<string, { business_name: unknown; slug: unknown }>()
  if (ids.length) {
    const { data: biz, error: bizError } = await admin.from("businesses").select("business_id, business_name, slug").in("business_id", ids)
    if (bizError) {
      console.error(JSON.stringify({ event: "settlements_business_read_failed", code: bizError.code ?? null }))
      return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
    }
    for (const b of (biz ?? []) as { business_id: string; business_name: unknown; slug: unknown }[]) names.set(b.business_id, b)
  }

  return NextResponse.json({ settlements: rows.map((r) => normaliseSettlement(r, names.get(String(r.business_id)))) })
}

export async function POST(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const version = b.expected_version
  if (
    (b.action !== "pay" && b.action !== "cancel") ||
    !isUuid(b.settlement_id) ||
    typeof version !== "number" ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 })
  }

  if (b.action === "pay") return pay(b.settlement_id, version)

  const reason = typeof b.reason === "string" ? b.reason.trim() : ""
  if (!reason || reason.length > 500) return NextResponse.json({ error: "invalid_reason" }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.rpc("settlement_cancel", {
    p_id: b.settlement_id,
    p_expected_version: version,
    p_actor_id: guard.admin.userId,
    p_reason: reason,
  })
  if (error) {
    const m = error.message
    if (m === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 })
    if (m === "version_conflict" || m === "invalid_transition" || m === "not_latest") {
      return NextResponse.json({ error: m }, { status: 409 })
    }
    if (m === "forbidden") return NextResponse.json({ error: "not_operator" }, { status: 403 })
    if (MISSING.has(error.code)) return NextResponse.json({ error: "finance_unavailable" }, { status: 503 })
    console.error(JSON.stringify({ event: "settlement_cancel_failed", settlement: b.settlement_id, code: error.code ?? null }))
    return NextResponse.json({ error: "save_failed" }, { status: 500 })
  }
  console.info(JSON.stringify({ event: "settlement_cancelled", operator: guard.admin.userId, settlement: b.settlement_id }))
  return NextResponse.json({ settlement: normaliseSettlement((data ?? {}) as Record<string, unknown>) })
}

async function pay(settlementId: string, expectedVersion: number) {
  const supabase = await getSupabaseClient()
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 })

  let res: Response
  try {
    res = await fetch(`${url}/functions/v1/operator-settlement-pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: anon },
      body: JSON.stringify({ settlement_id: settlementId, expected_version: expectedVersion }),
    })
  } catch {
    return NextResponse.json({ error: "payment_gateway_unavailable" }, { status: 503 })
  }
  const payload = (await res.json().catch(() => ({ error: "server_error" }))) as Record<string, unknown>
  console.log(
    JSON.stringify({
      event: "settlement_pay",
      settlement: settlementId,
      status: res.status,
      error: typeof payload.error === "string" ? payload.error : null,
    }),
  )
  if (res.ok && payload.settlement && typeof payload.settlement === "object") {
    return NextResponse.json({ settlement: normaliseSettlement(payload.settlement as Record<string, unknown>) }, { status: res.status })
  }
  return NextResponse.json(payload, { status: res.status })
}
