import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { isUuid, parseRevision } from "@/lib/zones/validate"
import { mapZoneError } from "@/lib/zones/errors"
import { readJsonObject } from "@/lib/zones/request"

export const dynamic = "force-dynamic"

/**
 * POST /api/zones/publish  { business_id, expected_revision, acknowledge_warnings }
 * Validates and publishes the draft as a new version. The operator id comes
 * from the session, never from the body.
 * -> { published_version, published_set_id, new_draft_revision }
 */
export async function POST(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const body = await readJsonObject(request)
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  if (!isUuid(body.business_id)) return NextResponse.json({ error: "invalid_payload", field: "business_id" }, { status: 400 })
  const revision = parseRevision(body.expected_revision)
  if (revision === null) return NextResponse.json({ error: "invalid_payload", field: "expected_revision" }, { status: 400 })
  if (typeof body.acknowledge_warnings !== "boolean") {
    return NextResponse.json({ error: "invalid_payload", field: "acknowledge_warnings" }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("publish_delivery_zone_set", {
    p_business_id: body.business_id,
    p_expected_revision: revision,
    p_acknowledge_warnings: body.acknowledge_warnings,
    p_operator_id: guard.admin.userId,
  })
  if (error) {
    const m = mapZoneError(error, { fn: "publish_delivery_zone_set", business_id: body.business_id })
    return NextResponse.json(m.body, { status: m.status })
  }
  return NextResponse.json(data)
}
