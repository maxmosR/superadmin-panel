import { NextResponse } from "next/server"
import { getPlatformAdmin } from "@/lib/superadmin-auth"
import { createAdminClient } from "@/lib/supabase-admin"
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
 */

const UUID_RE = /^[0-9a-f-]{36}$/i

export async function GET(request: Request) {
  const admin = await getPlatformAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const businessId = new URL(request.url).searchParams.get("business_id") ?? ""
  if (!UUID_RE.test(businessId)) return NextResponse.json({ error: "business_id is required" }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("business_provider_settings", { p_business_id: businessId })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ providers: data ?? [] })
}

export async function PUT(request: Request) {
  const admin = await getPlatformAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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
  const { error } = await supabase.from("business_providers").upsert(row, { onConflict: "business_id,provider_id" })
  if (error) {
    // The guard trigger rejects disabling a mandatory provider.
    const status = error.code === "22023" ? 400 : 500
    return NextResponse.json({ error: error.message }, { status })
  }
  return NextResponse.json({ saved: true })
}
