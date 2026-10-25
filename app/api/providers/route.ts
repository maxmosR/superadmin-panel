import { NextResponse } from "next/server"
import { getPlatformAdmin } from "@/lib/superadmin-auth"
import { createAdminClient } from "@/lib/supabase-admin"
import { CALC_MODES, CODE_RE, RATE_FIELDS, parsePhone, parseRate, type CalcMode } from "@/lib/providers"

export const dynamic = "force-dynamic"

/**
 * Platform master list of providers (sales channels / payment methods).
 *
 *   GET   /api/providers  all providers, active or not
 *   POST  /api/providers  create one
 *   PATCH /api/providers  update one by id (providers are disabled, never
 *                         deleted: invoices reference them)
 */

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
    row.name = name
  }
  if (creating || "calc_mode" in body) {
    const mode = String(body.calc_mode ?? "payment") as CalcMode
    if (!CALC_MODES.includes(mode)) throw new Error(`calc_mode must be one of ${CALC_MODES.join(", ")}`)
    row.calc_mode = mode
  }
  if ("is_active" in body) row.is_active = !!body.is_active
  if ("is_mandatory" in body) row.is_mandatory = !!body.is_mandatory
  if ("icon_url" in body) row.icon_url = String(body.icon_url ?? "").trim() || null
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
  const admin = await getPlatformAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("providers")
    .select(COLUMNS)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ providers: data ?? [] })
}

export async function POST(request: Request) {
  const admin = await getPlatformAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

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
  const { data, error } = await supabase.from("providers").insert(row).select(COLUMNS).single()
  if (error) {
    const status = error.code === "23505" ? 409 : 500
    const message = error.code === "23505" ? `A provider with code "${row.code}" already exists` : error.message
    return NextResponse.json({ error: message }, { status })
  }
  return NextResponse.json({ provider: data }, { status: 201 })
}

export async function PATCH(request: Request) {
  const admin = await getPlatformAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await readJson(request)
  if (!body || typeof body.id !== "string") {
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
  row.updated_at = new Date().toISOString()

  const supabase = createAdminClient()
  const { data, error } = await supabase.from("providers").update(row).eq("id", body.id).select(COLUMNS).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: "Provider not found" }, { status: 404 })
  return NextResponse.json({ provider: data })
}
