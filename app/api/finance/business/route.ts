// One restaurant's orders for a date range (operator only), from the
// commission ledger: one line per entry (order fee, refund, waiver, cap
// adjustment), with its Stripe fee and whether a cash fee can still be waived.
//   GET ?business_id=<uuid>&from=YYYY-MM-DD&to=YYYY-MM-DD
//     → BusinessDetail (lib/finance.ts), 404 when the restaurant is unknown.
// Same range rules as /api/finance/overview (Europe/Rome dates, `to`
// inclusive, cap progress for the month containing `to`). Reads
// commission_entries, card_fees and orders.order_number with the service role
// after the operator check; no customer data. Logs carry ids and counts only.
import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { isUuid } from "@/lib/zones/validate"
import { businessOrderLine, romeRange, toInt, toIntOrNull, type BusinessDetail, type LedgerEntryRow } from "@/lib/finance"

export const dynamic = "force-dynamic"

const MISSING = new Set(["PGRST202", "42883", "PGRST205", "42P01"])
const PAGE = 1000
const MAX_LINES = 20_000
const ID_CHUNK = 150

type DbError = { code?: string } | null

export async function GET(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const q = new URL(request.url).searchParams
  const businessId = q.get("business_id")
  if (!isUuid(businessId)) return NextResponse.json({ error: "invalid_business_id" }, { status: 400 })
  const range = romeRange(q.get("from"), q.get("to"))
  if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 })

  const admin = createAdminClient()
  const fail = (step: string, error: DbError) => {
    if (error?.code && MISSING.has(error.code)) return NextResponse.json({ error: "finance_unavailable" }, { status: 503 })
    console.error(JSON.stringify({ event: "finance_business_failed", step, business: businessId, code: error?.code ?? null }))
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  }

  const [biz, settings, month] = await Promise.all([
    admin.from("businesses").select("business_id, business_name, slug").eq("business_id", businessId).maybeSingle(),
    admin.from("commission_settings").select("rate_bps, monthly_cap_cents").eq("business_id", businessId).maybeSingle(),
    admin.from("commission_months").select("fee_cents, cap_reached_at").eq("business_id", businessId).eq("month", range.capMonth).maybeSingle(),
  ])
  if (biz.error) return fail("business", biz.error)
  if (!biz.data) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if (settings.error) return fail("settings", settings.error)
  if (month.error) return fail("month", month.error)

  const entries: LedgerEntryRow[] = []
  for (let offset = 0; offset < MAX_LINES; offset += PAGE) {
    const { data, error } = await admin
      .from("commission_entries")
      .select("id, order_id, kind, method, occurred_at, amount_cents, base_cents, card_cents, rate_bps, full_fee_cents, fee_cents")
      .eq("business_id", businessId)
      .gte("occurred_at", range.fromTs)
      .lt("occurred_at", range.toTs)
      // Newest first.
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + PAGE - 1)
    if (error) return fail("entries", error)
    const rows = (data ?? []) as LedgerEntryRow[]
    entries.push(...rows)
    if (rows.length < PAGE) break
  }

  const ids = [...new Set(entries.map((e) => String(e.order_id)))]
  const numbers = new Map<string, string>()
  const fees = new Map<string, number>()
  // Orders with a waiver, wherever it falls in time (it may be outside the range).
  const waived = new Set<string>()
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK)
    const [orders, cardFees, waivers] = await Promise.all([
      admin.from("orders").select("id, order_number").eq("business_id", businessId).in("id", chunk),
      admin.from("card_fees").select("order_id, fee_cents").eq("business_id", businessId).in("order_id", chunk),
      admin.from("commission_entries").select("order_id").eq("business_id", businessId).eq("kind", "waiver").in("order_id", chunk),
    ])
    if (orders.error) return fail("orders", orders.error)
    if (cardFees.error) return fail("card_fees", cardFees.error)
    if (waivers.error) return fail("waivers", waivers.error)
    for (const w of (waivers.data ?? []) as { order_id: string }[]) waived.add(String(w.order_id))
    for (const o of (orders.data ?? []) as { id: string; order_number: unknown }[]) {
      if (o.order_number !== null && o.order_number !== undefined) numbers.set(o.id, String(o.order_number))
    }
    for (const f of (cardFees.data ?? []) as { order_id: string; fee_cents: unknown }[]) fees.set(f.order_id, toInt(f.fee_cents))
  }

  const b = biz.data as { business_id: string; business_name: unknown; slug: unknown }
  const body: BusinessDetail = {
    from: range.from,
    to: range.to,
    cap_month: range.capMonth,
    business: { business_id: b.business_id, business_name: String(b.business_name ?? ""), slug: String(b.slug ?? "") },
    settings: {
      rate_bps: toInt(settings.data?.rate_bps),
      monthly_cap_cents: settings.data ? toIntOrNull(settings.data.monthly_cap_cents) : null,
    },
    cap: {
      fee_cents: toInt(month.data?.fee_cents),
      cap_reached_at: typeof month.data?.cap_reached_at === "string" ? month.data.cap_reached_at : null,
    },
    lines: entries.map((e) => {
      const id = String(e.order_id)
      return businessOrderLine(e, numbers.get(id) ?? null, fees.has(id) ? (fees.get(id) as number) : null, waived.has(id))
    }),
  }
  return NextResponse.json(body)
}
