// A restaurant's own fiscal id for its receipts (operator only).
//   GET ?business_id=…              → { fiscal_id: string | null, updated_at: string | null }
//   PUT { business_id, fiscal_id }  → { ok: true, fiscal_id }
// business_fiscal_settings has no client write policy: the service role
// writes it, after the operator check. fiscal_id is an Italian Partita IVA
// (11 digits) or codice fiscale (16 characters), stored upper-case
// (lib/fiscal-id.ts). Logs carry ids only, never the fiscal id.
import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { parseFiscalId } from "@/lib/fiscal-id"
import { isUuid } from "@/lib/zones/validate"

export const dynamic = "force-dynamic"

// The table isn't deployed yet on this database (schema cache / undefined table).
const MISSING_TABLE = new Set(["PGRST205", "42P01"])

export async function GET(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const businessId = new URL(request.url).searchParams.get("business_id")
  if (!isUuid(businessId)) return NextResponse.json({ error: "invalid_business_id" }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("business_fiscal_settings")
    .select("fiscal_id, updated_at")
    .eq("business_id", businessId)
    .maybeSingle()
  if (error) {
    if (MISSING_TABLE.has(error.code)) return NextResponse.json({ error: "fiscal_settings_unavailable" }, { status: 503 })
    console.error(JSON.stringify({ event: "fiscal_settings_read_failed", business: businessId, code: error.code }))
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  }
  const row = data as { fiscal_id: string; updated_at: string } | null
  return NextResponse.json({ fiscal_id: row?.fiscal_id ?? null, updated_at: row?.updated_at ?? null })
}

export async function PUT(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const b = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  if (!isUuid(b.business_id)) return NextResponse.json({ error: "invalid_business_id" }, { status: 400 })
  const parsed = parseFiscalId(b.fiscal_id)
  if (!parsed.ok) return NextResponse.json({ error: "invalid_fiscal_id" }, { status: 400 })

  const admin = createAdminClient()
  const { data: business, error: bizError } = await admin
    .from("businesses")
    .select("business_id")
    .eq("business_id", b.business_id)
    .maybeSingle()
  if (bizError) return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  if (!business) return NextResponse.json({ error: "business_not_found" }, { status: 404 })

  const { error } = await admin.from("business_fiscal_settings").upsert(
    {
      business_id: b.business_id,
      fiscal_id: parsed.value,
      updated_at: new Date().toISOString(),
      updated_by: guard.admin.userId,
    },
    { onConflict: "business_id" },
  )
  if (error) {
    if (MISSING_TABLE.has(error.code)) return NextResponse.json({ error: "fiscal_settings_unavailable" }, { status: 503 })
    console.error(JSON.stringify({ event: "fiscal_settings_write_failed", business: b.business_id, code: error.code }))
    return NextResponse.json({ error: "update_failed" }, { status: 500 })
  }
  console.info(JSON.stringify({ event: "fiscal_settings_set", operator: guard.admin.userId, business: b.business_id }))
  return NextResponse.json({ ok: true, fiscal_id: parsed.value })
}
