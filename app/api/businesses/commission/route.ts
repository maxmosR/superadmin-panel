// A restaurant's commission rate and monthly cap (operator only).
//   GET ?business_id=…  → { business_id, rate_bps, monthly_cap_cents | null, updated_at | null }
//   PUT { business_id, rate_percent: 0–100 (≤ 2 decimals), monthly_cap_eur: ≥ 0 (≤ 2 decimals) | null }
//     → the same shape. Written only through set_commission_settings (service
//       role, this operator as the actor). No row means 0 % and no cap.
// Percent and euro are parsed from their decimal string into integer basis
// points and cents (lib/finance.ts), never through float maths.
import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { isUuid } from "@/lib/zones/validate"
import { parseEuroToCents, parseRatePercent, toInt, toIntOrNull } from "@/lib/finance"

export const dynamic = "force-dynamic"

const MISSING = new Set(["PGRST202", "42883", "PGRST205", "42P01"])

function shape(businessId: string, row: Record<string, unknown> | null) {
  return {
    business_id: businessId,
    rate_bps: row ? toInt(row.rate_bps) : 0,
    monthly_cap_cents: row ? toIntOrNull(row.monthly_cap_cents) : null,
    updated_at: row && typeof row.updated_at === "string" ? row.updated_at : null,
  }
}

export async function GET(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const businessId = new URL(request.url).searchParams.get("business_id")
  if (!isUuid(businessId)) return NextResponse.json({ error: "invalid_business_id" }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("commission_settings")
    .select("rate_bps, monthly_cap_cents, updated_at")
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) {
    if (MISSING.has(error.code)) return NextResponse.json({ error: "finance_unavailable" }, { status: 503 })
    console.error(JSON.stringify({ event: "commission_read_failed", business: businessId, code: error.code ?? null }))
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  }
  return NextResponse.json(shape(businessId, data as Record<string, unknown> | null))
}

export async function PUT(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (!isUuid(b.business_id)) return NextResponse.json({ error: "invalid_business_id" }, { status: 400 })
  if (typeof b.rate_percent !== "number") return NextResponse.json({ error: "invalid_rate" }, { status: 400 })
  const rateBps = parseRatePercent(b.rate_percent)
  if (rateBps === null) return NextResponse.json({ error: "invalid_rate" }, { status: 400 })
  let capCents: number | null = null
  if (b.monthly_cap_eur !== null && b.monthly_cap_eur !== undefined) {
    if (typeof b.monthly_cap_eur !== "number") return NextResponse.json({ error: "invalid_cap" }, { status: 400 })
    capCents = parseEuroToCents(b.monthly_cap_eur)
    if (capCents === null) return NextResponse.json({ error: "invalid_cap" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc("set_commission_settings", {
    p_business_id: b.business_id,
    p_actor_id: guard.admin.userId,
    p_rate_bps: rateBps,
    p_monthly_cap_cents: capCents,
  })
  if (error) {
    if (error.message === "not_found") return NextResponse.json({ error: "business_not_found" }, { status: 404 })
    if (error.message === "invalid_payload") return NextResponse.json({ error: "invalid_payload" }, { status: 400 })
    if (error.message === "forbidden") return NextResponse.json({ error: "not_operator" }, { status: 403 })
    if (MISSING.has(error.code)) return NextResponse.json({ error: "finance_unavailable" }, { status: 503 })
    console.error(JSON.stringify({ event: "commission_write_failed", business: b.business_id, code: error.code ?? null }))
    return NextResponse.json({ error: "save_failed" }, { status: 500 })
  }
  console.info(JSON.stringify({ event: "commission_set", operator: guard.admin.userId, business: b.business_id }))
  return NextResponse.json(shape(b.business_id, (data ?? null) as Record<string, unknown> | null))
}
