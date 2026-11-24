import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { isUuid } from "@/lib/zones/validate"
import { auditFailedResponse, recordOperatorAudit } from "@/lib/operator-audit"
import { CALC_MODES, CODE_RE, parseIconUrl, RATE_FIELDS, countUsingDefaults, parsePhone, parseRate, type CalcMode, type ProviderLink } from "@/lib/providers"

export const dynamic = "force-dynamic"

/**
 * Platform master list of providers (sales channels / payment methods).
 *
 *   GET   /api/providers  all providers, active or not
 *   POST  /api/providers  create one
 *   PATCH /api/providers  update one by id (providers are disabled, never
 *                         deleted: invoices reference them)
 *
 * Creates and updates are audited first (record_audit "provider_changed":
 * provider id / code and the changed column names); without the row nothing
 * is written (500 audit_failed). Database errors answer stable codes and are
 * logged by code only.
 */

function dbFailed(event: string, code: string | null | undefined, error: string) {
  console.error(JSON.stringify({ event, code: code ?? null }))
  return NextResponse.json({ error }, { status: 500 })
}

const COLUMNS =
  "id, code, name, calc_mode, is_active, is_mandatory, icon_url, sort_order, default_fee_rate, default_iva_rate, " +
  "default_stripe_fee_rate, default_stripe_fixed_fee, default_tax_rate, default_customer_service_number"

type Body = Record<string, unknown>

async function readJson(request: Request): Promise<Body | null> {
  try {
    return (await request.json()) as Body
  } catch {
    return null
  }
}

/** Columns to write from a request body; only keys present are touched. */
function toRow(body: Body, creating: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = {}

  if (creating || "name" in body) {
    const name = String(body.name ?? "").trim()
    if (!name) throw new Error("name is required")
    if (name.length > 80) throw new Error("name must be at most 80 characters")
    row.name = name
  }
  if (creating || "calc_mode" in body) {
    const mode = String(body.calc_mode ?? "payment") as CalcMode
    if (!CALC_MODES.includes(mode)) throw new Error(`calc_mode must be one of ${CALC_MODES.join(", ")}`)
    row.calc_mode = mode
  }
  if ("is_active" in body) row.is_active = !!body.is_active
  if ("is_mandatory" in body) row.is_mandatory = !!body.is_mandatory
  if ("icon_url" in body) row.icon_url = parseIconUrl(body.icon_url)
  if ("sort_order" in body) {
    const n = Number(body.sort_order)
    if (!Number.isInteger(n)) throw new Error("sort_order must be a whole number")
    row.sort_order = n
  }
  for (const f of RATE_FIELDS) {
    const key = `default_${f}`
    if (creating || key in body) row[key] = parseRate(f, body[key] ?? 0, false)
  }
  if ("default_customer_service_number" in body) {
    row.default_customer_service_number = parsePhone(body.default_customer_service_number)
  }

  // A mandatory provider must stay usable.
  if (row.is_mandatory === true) row.is_active = true
  return row
}

export async function GET() {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const supabase = createAdminClient()
  const [{ data, error }, { data: bizRows, error: bizErr }, { data: links, error: linkErr }] = await Promise.all([
    supabase.from("providers").select(COLUMNS).order("sort_order", { ascending: true }).order("name", { ascending: true }),
    supabase.from("businesses").select("business_id").eq("deleted", false),
    supabase
      .from("business_providers")
      .select("business_id, provider_id, is_enabled, fee_rate, iva_rate, stripe_fee_rate, stripe_fixed_fee, tax_rate"),
  ])
  if (error) return dbFailed("providers_read_failed", error.code, "lookup_failed")
  if (bizErr || linkErr) {
    // The list still works without the counts; log codes only.
    console.error(JSON.stringify({ event: "provider_usage_failed", code: (bizErr ?? linkErr)?.code ?? null }))
  }

  const live = new Set((bizRows ?? []).map((b: { business_id: string }) => b.business_id))
  const counted = !bizErr && !linkErr
  const providers = ((data ?? []) as unknown as Array<{ id: string; is_mandatory: boolean }>).map((p) => ({
    ...p,
    uses_defaults: counted ? countUsingDefaults(p, live, (links ?? []) as ProviderLink[]) : null,
  }))
  return NextResponse.json({ providers })
}

export async function POST(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

  let row: Record<string, unknown>
  try {
    const code = String(body.code ?? "").trim().toLowerCase()
    if (!CODE_RE.test(code)) throw new Error("code must be 2–40 characters: lowercase letters, digits or _")
    row = { code, ...toRow(body, true) }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  const supabase = createAdminClient()
  const audit = await recordOperatorAudit(supabase, {
    action: "provider_changed",
    actorUserId: guard.admin.userId,
    detail: { operation: "create", provider_code: String(row.code), fields: Object.keys(row).sort() },
  })
  if (!audit.ok) return auditFailedResponse()

  const { data, error } = await supabase.from("providers").insert(row).select(COLUMNS).single()
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: `A provider with code "${row.code}" already exists` }, { status: 409 })
    return dbFailed("provider_create_failed", error.code, "create_failed")
  }
  return NextResponse.json({ provider: data }, { status: 201 })
}

export async function PATCH(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const body = await readJson(request)
  if (!body || !isUuid(body.id)) {
    return NextResponse.json({ error: "id is required" }, { status: 400 })
  }

  let row: Record<string, unknown>
  try {
    row = toRow(body, false)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
  // The code is what invoices store; it is fixed once created.
  if (!Object.keys(row).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  const fields = Object.keys(row).sort()
  row.updated_at = new Date().toISOString()

  const supabase = createAdminClient()
  const audit = await recordOperatorAudit(supabase, {
    action: "provider_changed",
    actorUserId: guard.admin.userId,
    detail: { operation: "update", provider_id: body.id, fields },
  })
  if (!audit.ok) return auditFailedResponse()

  const { data, error } = await supabase.from("providers").update(row).eq("id", body.id).select(COLUMNS).maybeSingle()
  if (error) return dbFailed("provider_update_failed", error.code, "update_failed")
  if (!data) return NextResponse.json({ error: "Provider not found" }, { status: 404 })
  return NextResponse.json({ provider: data })
}
