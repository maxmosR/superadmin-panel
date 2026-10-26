import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { isUuid, parseVersion } from "@/lib/zones/validate"
import { mapZoneError } from "@/lib/zones/errors"

export const dynamic = "force-dynamic"

/** GET /api/zones/version?business_id=&version=  one published or archived version (read-only). */
export async function GET(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const params = new URL(request.url).searchParams
  const businessId = params.get("business_id")
  if (!isUuid(businessId)) return NextResponse.json({ error: "invalid_business_id" }, { status: 400 })
  const version = parseVersion(params.get("version"))
  if (version === null) return NextResponse.json({ error: "invalid_payload", field: "version" }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("get_delivery_zone_set_geojson", { p_business_id: businessId, p_which: String(version) })
  if (error) {
    const m = mapZoneError(error, { fn: "get_delivery_zone_set_geojson", business_id: businessId })
    return NextResponse.json(m.body, { status: m.status })
  }
  if (!data) return NextResponse.json({ error: "version_not_found" }, { status: 404 })
  return NextResponse.json({ zone_set: data })
}
