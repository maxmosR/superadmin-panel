import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { isUuid, parseLatLng } from "@/lib/zones/validate"
import { mapZoneError } from "@/lib/zones/errors"
import { firstRow, readJsonObject } from "@/lib/zones/request"
import type { QuoteResult } from "@/lib/zones/types"

export const dynamic = "force-dynamic"

/**
 * POST /api/zones/test  { business_id, lat, lng }
 * What this point would pay under the draft and under the live version,
 * from the same SQL core as the real quote: { draft, published }.
 */
export async function POST(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const body = await readJsonObject(request)
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  if (!isUuid(body.business_id)) return NextResponse.json({ error: "invalid_payload", field: "business_id" }, { status: 400 })
  const point = parseLatLng(body)
  if (!point) return NextResponse.json({ error: "invalid_payload", field: "lat_lng" }, { status: 400 })

  const supabase = createAdminClient()
  const call = (target: "draft" | "published") =>
    supabase.rpc("test_delivery_address", { p_business_id: body.business_id, p_lat: point.lat, p_lng: point.lng, p_target: target })
  const [draft, published] = await Promise.all([call("draft"), call("published")])
  const error = draft.error ?? published.error
  if (error) {
    const m = mapZoneError(error, { fn: "test_delivery_address", business_id: body.business_id as string })
    return NextResponse.json(m.body, { status: m.status })
  }
  return NextResponse.json({ draft: firstRow<QuoteResult>(draft.data), published: firstRow<QuoteResult>(published.data) })
}
