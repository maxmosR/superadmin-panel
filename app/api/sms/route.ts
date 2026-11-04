import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import {
  ALIAS_SELECT,
  currentAlias,
  EMPTY_USAGE,
  isMissingSmsSchema,
  MISSING_SMS_SCHEMA_ERROR,
  romeDayStart,
  romeMonthStartDay,
  type SmsAlias,
  type SmsUsage,
} from "@/lib/sms"

export const dynamic = "force-dynamic"

type UsageRow = SmsUsage & { business_id: string }

function byBusiness(rows: UsageRow[] | null): Map<string, SmsUsage> {
  const m = new Map<string, SmsUsage>()
  for (const r of rows ?? []) {
    m.set(r.business_id, {
      messages: Number(r.messages) || 0,
      sms_parts: Number(r.sms_parts) || 0,
      delivered: Number(r.delivered) || 0,
      failed: Number(r.failed) || 0,
      total_cost: Number(r.total_cost) || 0,
    })
  }
  return m
}

// ---------------------------------------------------------------------------
// GET /api/sms — every restaurant with its SMS alias (live one, else newest)
// and its SMS usage this month (Europe/Rome) and in total.
// ---------------------------------------------------------------------------
export async function GET() {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const supabase = createAdminClient()
  const monthStart = romeDayStart(romeMonthStartDay())
  const [biz, aliases, month, total] = await Promise.all([
    supabase.from("businesses").select("business_id, business_name, slug, whatsapp_number, phone").eq("deleted", false).order("business_name"),
    supabase.from("sms_sender_aliases").select(ALIAS_SELECT),
    supabase.rpc("sms_usage_totals", { p_from: monthStart, p_to: null }),
    supabase.rpc("sms_usage_totals", { p_from: null, p_to: null }),
  ])
  const failed = [biz, aliases, month, total].find((r) => r.error)
  if (failed?.error) {
    if (isMissingSmsSchema(failed.error)) return NextResponse.json({ error: MISSING_SMS_SCHEMA_ERROR }, { status: 503 })
    console.error(JSON.stringify({ event: "sms_list_failed", code: failed.error.code }))
    return NextResponse.json({ error: "Failed to load SMS data" }, { status: 500 })
  }

  const aliasRows = (aliases.data ?? []) as SmsAlias[]
  const monthBy = byBusiness(month.data as UsageRow[] | null)
  const totalBy = byBusiness(total.data as UsageRow[] | null)

  const rows = (biz.data ?? []).map((b) => ({
    business_id: b.business_id as string,
    business_name: b.business_name as string,
    slug: b.slug as string,
    whatsapp_set: !!(b.whatsapp_number || b.phone),
    alias: currentAlias(aliasRows.filter((a) => a.business_id === b.business_id)),
    usage_month: monthBy.get(b.business_id as string) ?? EMPTY_USAGE,
    usage_total: totalBy.get(b.business_id as string) ?? EMPTY_USAGE,
  }))
  return NextResponse.json({ businesses: rows })
}
