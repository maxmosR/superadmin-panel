import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { auditFailedResponse, recordOperatorAudit } from "@/lib/operator-audit"
import { RATE_FIELDS, parsePhone, parseRate } from "@/lib/providers"

export const dynamic = "force-dynamic"

/**
 * One business' providers and rates, as a platform admin sees and sets them.
 *
 *   GET /api/businesses/providers?business_id=…  every provider with the
 *       business' effective and own values (business_provider_settings)
 *   PUT /api/businesses/providers  { business_id, provider_id, is_enabled,
 *       fee_rate, iva_rate, stripe_fee_rate, stripe_fixed_fee, tax_rate,
 *       customer_service_number, tax_locked }  — empty rate = provider default.
 *       `tax_locked` stops the business from changing iva_rate / tax_rate.
 *       Audited first (record_audit "business_provider_changed": business and
 *       provider ids, enabled / locked flags); without the row nothing is
 *       written (500 audit_failed). Database errors answer stable codes.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i

export async function GET(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const businessId = new URL(request.url).searchParams.get("business_id") ?? ""
  if (!UUID_RE.test(businessId)) return NextResponse.json({ error: "business_id is required" }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("business_provider_settings", { p_business_id: businessId })
  if (error) {
    console.error(JSON.stringify({ event: "business_providers_read_failed", business: businessId, code: error.code ?? null }))
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  }
  return NextResponse.json({ providers: data ?? [] })
}

export async function PUT(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const businessId = String(body.business_id ?? "")
  const providerId = String(body.provider_id ?? "")
  if (!UUID_RE.test(businessId) || !UUID_RE.test(providerId)) {
    return NextResponse.json({ error: "business_id and provider_id are required" }, { status: 400 })
  }

  const row: Record<string, unknown> = {
    business_id: businessId,
    provider_id: providerId,
    is_enabled: body.is_enabled !== false,
    tax_locked: !!body.tax_locked,
  }
  try {
    for (const f of RATE_FIELDS) row[f] = parseRate(f, body[f], true)
    row.customer_service_number = parsePhone(body.customer_service_number)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  const supabase = createAdminClient()
  const audit = await recordOperatorAudit(supabase, {
    action: "business_provider_changed",
    actorUserId: guard.admin.userId,
    businessId,
    detail: { provider_id: providerId, is_enabled: row.is_enabled as boolean, tax_locked: row.tax_locked as boolean },
  })
  if (!audit.ok) return auditFailedResponse()

  const { error } = await supabase.from("business_providers").upsert(row, { onConflict: "business_id,provider_id" })
  if (error) {
    // The guard trigger rejects disabling a mandatory provider (22023).
    if (error.code === "22023") return NextResponse.json({ error: "provider_mandatory" }, { status: 400 })
    // 23503: no such restaurant or provider.
    if (error.code === "23503") return NextResponse.json({ error: "not_found" }, { status: 404 })
    console.error(JSON.stringify({ event: "business_provider_save_failed", business: businessId, provider: providerId, code: error.code ?? null }))
    return NextResponse.json({ error: "save_failed" }, { status: 500 })
  }
  return NextResponse.json({ saved: true })
}
