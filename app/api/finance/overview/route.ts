// Per-restaurant money for a date range (operator only).
//   GET ?from=YYYY-MM-DD&to=YYYY-MM-DD   (Europe/Rome calendar dates, `to` inclusive)
//     → { from, to, cap_month, businesses: FinanceOverviewRow[] }
// One SQL call, operator_finance_overview, with the service role after the
// operator check. The range is [from 00:00 Rome, to + 1 day 00:00 Rome); the
// cap progress is for the month containing `to`. Logs carry counts only.
import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { normaliseOverviewRow, romeRange } from "@/lib/finance"

export const dynamic = "force-dynamic"

// The function isn't deployed on this database yet.
const MISSING = new Set(["PGRST202", "42883", "PGRST205", "42P01"])

export async function GET(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const q = new URL(request.url).searchParams
  const range = romeRange(q.get("from"), q.get("to"))
  if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.rpc("operator_finance_overview", {
    p_from: range.fromTs,
    p_to: range.toTs,
    p_cap_month: range.capMonth,
  })
  if (error) {
    if (MISSING.has(error.code)) return NextResponse.json({ error: "finance_unavailable" }, { status: 503 })
    console.error(JSON.stringify({ event: "finance_overview_failed", code: error.code ?? null }))
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  }
  const rows = ((data ?? []) as Record<string, unknown>[]).map(normaliseOverviewRow)
  return NextResponse.json({ from: range.from, to: range.to, cap_month: range.capMonth, businesses: rows })
}
