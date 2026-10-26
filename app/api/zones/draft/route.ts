import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { isUuid, parseDraftPayload, parseRevision } from "@/lib/zones/validate"
import { mapZoneError } from "@/lib/zones/errors"
import { readJsonObject } from "@/lib/zones/request"

export const dynamic = "force-dynamic"

/**
 * PUT /api/zones/draft
 * { business_id, expected_revision, origin, rings, cut_lines, rules }
 * Replaces the restaurant's draft (creating it if needed) and returns the
 * recomputed pieces: { revision, pieces, issues, extended_lines }.
 */
export async function PUT(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const body = await readJsonObject(request)
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  if (!isUuid(body.business_id)) return NextResponse.json({ error: "invalid_payload", field: "business_id" }, { status: 400 })
  const revision = parseRevision(body.expected_revision)
  if (revision === null) return NextResponse.json({ error: "invalid_payload", field: "expected_revision" }, { status: 400 })
  const check = parseDraftPayload(body)
  if (!check.ok) return NextResponse.json({ error: "invalid_payload", field: check.field }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("save_delivery_zone_draft", {
    p_business_id: body.business_id,
    p_expected_revision: revision,
    p_payload: check.payload,
  })
  if (error) {
    const m = mapZoneError(error, { fn: "save_delivery_zone_draft", business_id: body.business_id })
    return NextResponse.json(m.body, { status: m.status })
  }
  return NextResponse.json(data)
}
