import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { isUuid, parseRevision } from "@/lib/zones/validate"
import { mapZoneError } from "@/lib/zones/errors"
import { readJsonObject } from "@/lib/zones/request"

export const dynamic = "force-dynamic"

/**
 * POST /api/zones/draft/discard  { business_id, expected_revision }
 * Resets the draft to a copy of the published set (or deletes it when
 * nothing was ever published). Returns { draft } (null when deleted).
 */
export async function POST(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const body = await readJsonObject(request)
  if (!body) return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  if (!isUuid(body.business_id)) return NextResponse.json({ error: "invalid_payload", field: "business_id" }, { status: 400 })
  const revision = parseRevision(body.expected_revision)
  if (revision === null) return NextResponse.json({ error: "invalid_payload", field: "expected_revision" }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("discard_delivery_zone_draft", {
    p_business_id: body.business_id,
    p_expected_revision: revision,
  })
  if (error) {
    const m = mapZoneError(error, { fn: "discard_delivery_zone_draft", business_id: body.business_id })
    return NextResponse.json(m.body, { status: m.status })
  }
  return NextResponse.json({ draft: data ?? null })
}
