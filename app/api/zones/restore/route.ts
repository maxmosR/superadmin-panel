import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { isUuid, parseRevision, parseVersion } from "@/lib/zones/validate"
import { mapZoneError } from "@/lib/zones/errors"
import { readJsonObject } from "@/lib/zones/request"

export const dynamic = "force-dynamic"

/**
 * POST /api/zones/restore  { business_id, version, expected_revision }
 * Copies a past version into the draft (the old version is never changed);
 * publishing it makes a new version. Returns { draft }.
 */
export async function POST(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const body = await readJsonObject(request)
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  if (!isUuid(body.business_id)) return NextResponse.json({ error: "invalid_payload", field: "business_id" }, { status: 400 })
  const version = parseVersion(body.version)
  if (version === null) return NextResponse.json({ error: "invalid_payload", field: "version" }, { status: 400 })
  const revision = parseRevision(body.expected_revision)
  if (revision === null) return NextResponse.json({ error: "invalid_payload", field: "expected_revision" }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("restore_delivery_zone_version", {
    p_business_id: body.business_id,
    p_version: version,
    p_expected_revision: revision,
  })
  if (error) {
    const m = mapZoneError(error, { fn: "restore_delivery_zone_version", business_id: body.business_id })
    return NextResponse.json(m.body, { status: m.status })
  }
  return NextResponse.json({ draft: data })
}
