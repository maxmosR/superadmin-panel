// A restaurant's storefront tracking ids (operator only).
//   GET ?business_id=…                                    → { ga4_measurement_id, meta_pixel_id } (null = not used)
//   PUT { business_id, ga4_measurement_id, meta_pixel_id } → { ok: true, ga4_measurement_id, meta_pixel_id }
// Both live on business_configurations. Staff hold no update grant on these
// columns, so only the service role writes them, after the operator check.
// The storefront loads each tag only after the visitor's cookie consent and
// picks a change up within a minute (its tenant lookup cache).
import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { parseGa4Id, parseMetaPixelId } from "@/lib/tracking-ids"
import { isUuid } from "@/lib/zones/validate"

export const dynamic = "force-dynamic"

// The columns aren't deployed yet on this database (undefined column / schema cache).
const MISSING_COLUMN = new Set(["42703", "PGRST204"])

export async function GET(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const businessId = new URL(request.url).searchParams.get("business_id")
  if (!isUuid(businessId)) return NextResponse.json({ error: "invalid_business_id" }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("business_configurations")
    .select("ga4_measurement_id, meta_pixel_id")
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) {
    if (MISSING_COLUMN.has(error.code)) return NextResponse.json({ error: "tracking_unavailable" }, { status: 503 })
    console.error(JSON.stringify({ event: "tracking_read_failed", business: businessId, code: error.code }))
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  }
  const row = data as { ga4_measurement_id: string | null; meta_pixel_id: string | null } | null
  return NextResponse.json({ ga4_measurement_id: row?.ga4_measurement_id ?? null, meta_pixel_id: row?.meta_pixel_id ?? null })
}

export async function PUT(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const b = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  if (!isUuid(b.business_id)) return NextResponse.json({ error: "invalid_business_id" }, { status: 400 })
  const ga4 = parseGa4Id(b.ga4_measurement_id)
  if (!ga4.ok) return NextResponse.json({ error: "invalid_ga4_measurement_id" }, { status: 400 })
  const pixel = parseMetaPixelId(b.meta_pixel_id)
  if (!pixel.ok) return NextResponse.json({ error: "invalid_meta_pixel_id" }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("business_configurations")
    .update({ ga4_measurement_id: ga4.value, meta_pixel_id: pixel.value, updated_by: guard.admin.userId, updated_at: new Date().toISOString() })
    .eq("business_id", b.business_id)
    .select("business_id")
  if (error) {
    if (MISSING_COLUMN.has(error.code)) return NextResponse.json({ error: "tracking_unavailable" }, { status: 503 })
    console.error(JSON.stringify({ event: "tracking_write_failed", business: b.business_id, code: error.code }))
    return NextResponse.json({ error: "update_failed" }, { status: 500 })
  }
  if (!data || data.length === 0) return NextResponse.json({ error: "configuration_not_found" }, { status: 404 })
  // Public ids, not personal data: logged so a change can be traced.
  console.info(
    JSON.stringify({ event: "tracking_set", operator: guard.admin.userId, business: b.business_id, ga4: ga4.value, pixel: pixel.value }),
  )
  return NextResponse.json({ ok: true, ga4_measurement_id: ga4.value, meta_pixel_id: pixel.value })
}
