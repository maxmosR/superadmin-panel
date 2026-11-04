import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import {
  ALIAS_SELECT,
  EMPTY_USAGE,
  maskPhone,
  rangeFromParams,
  romeDayStart,
  romeMonthStartDay,
  type SmsAlias,
  type SmsMessageRow,
  type SmsUsage,
  isMissingSmsSchema,
  MISSING_SMS_SCHEMA_ERROR,
} from "@/lib/sms"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MESSAGES_LIMIT = 50

function usageFor(rows: unknown, businessId: string): SmsUsage {
  const r = ((rows ?? []) as Array<SmsUsage & { business_id: string }>).find((x) => x.business_id === businessId)
  if (!r) return EMPTY_USAGE
  return {
    messages: Number(r.messages) || 0,
    sms_parts: Number(r.sms_parts) || 0,
    delivered: Number(r.delivered) || 0,
    failed: Number(r.failed) || 0,
    total_cost: Number(r.total_cost) || 0,
  }
}

// ---------------------------------------------------------------------------
// GET /api/sms/business?business_id=…&from=YYYY-MM-DD&to=YYYY-MM-DD
// One restaurant: its aliases (newest first), SMS usage in the range (Rome
// days, inclusive; open ends allowed), this month and in total, and the
// latest messages in the range. Phones are masked.
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const url = new URL(request.url)
  const businessId = url.searchParams.get("business_id") ?? ""
  if (!UUID_RE.test(businessId)) return NextResponse.json({ error: "business_id is required" }, { status: 400 })
  const range = rangeFromParams(url.searchParams.get("from"), url.searchParams.get("to"))
  if (!range) return NextResponse.json({ error: "from / to must be YYYY-MM-DD" }, { status: 400 })

  const supabase = createAdminClient()
  let messagesQ = supabase
    .from("sms_logs")
    .select(
      "id, purpose, channel, recipient_phone, sender, status, delivery_state, error_code, segment_count, total_price, provider_message_id, requested_at, sent_at, delivered_at",
    )
    .eq("business_id", businessId)
    .neq("provider", "dry_run")
    .order("requested_at", { ascending: false })
    .limit(MESSAGES_LIMIT)
  if (range.from) messagesQ = messagesQ.gte("requested_at", range.from)
  if (range.to) messagesQ = messagesQ.lt("requested_at", range.to)

  const [biz, aliases, inRange, month, total, messages] = await Promise.all([
    supabase.from("businesses").select("business_id, business_name, slug, whatsapp_number, phone, deleted").eq("business_id", businessId).maybeSingle(),
    supabase.from("sms_sender_aliases").select(ALIAS_SELECT).eq("business_id", businessId).order("updated_at", { ascending: false }),
    supabase.rpc("sms_usage_totals", { p_from: range.from, p_to: range.to }),
    supabase.rpc("sms_usage_totals", { p_from: romeDayStart(romeMonthStartDay()), p_to: null }),
    supabase.rpc("sms_usage_totals", { p_from: null, p_to: null }),
    messagesQ,
  ])
  const failed = [biz, aliases, inRange, month, total, messages].find((r) => r.error)
  if (failed?.error) {
    if (isMissingSmsSchema(failed.error)) return NextResponse.json({ error: MISSING_SMS_SCHEMA_ERROR }, { status: 503 })
    console.error(JSON.stringify({ event: "sms_business_failed", code: failed.error.code }))
    return NextResponse.json({ error: "Failed to load SMS data" }, { status: 500 })
  }
  if (!biz.data || biz.data.deleted) return NextResponse.json({ error: "Business not found" }, { status: 404 })

  const rows: SmsMessageRow[] = (messages.data ?? []).map((m) => ({
    id: m.id as string,
    purpose: m.purpose as string,
    channel: m.channel as string,
    recipient: maskPhone(m.recipient_phone as string | null),
    sender: (m.sender as string | null) ?? null,
    status: m.status as string,
    delivery_state: (m.delivery_state as string | null) ?? null,
    error_code: (m.error_code as string | null) ?? null,
    segment_count: (m.segment_count as number | null) ?? null,
    total_price: m.total_price === null ? null : Number(m.total_price),
    provider_message_id: (m.provider_message_id as string | null) ?? null,
    requested_at: m.requested_at as string,
    sent_at: (m.sent_at as string | null) ?? null,
    delivered_at: (m.delivered_at as string | null) ?? null,
  }))

  return NextResponse.json({
    business: {
      business_id: biz.data.business_id,
      business_name: biz.data.business_name,
      slug: biz.data.slug,
      whatsapp_number: biz.data.whatsapp_number ?? null,
      phone: biz.data.phone ?? null,
    },
    aliases: (aliases.data ?? []) as SmsAlias[],
    usage: {
      range: usageFor(inRange.data, businessId),
      month: usageFor(month.data, businessId),
      total: usageFor(total.data, businessId),
    },
    messages: rows,
  })
}
