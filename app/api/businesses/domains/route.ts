import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { normalizeDomain } from "@/lib/domains"

export const dynamic = "force-dynamic"

/**
 * Domain management for a business. A business may own any number of domains;
 * exactly one of them is the primary (enforced by a partial unique index).
 *
 * Nothing here ever leaves the server with a business_id attached to a public
 * response — this console is platform-admin only, gated by requireOperator() in every handler.
 */

type Body = Record<string, unknown>

async function readJson(request: Request): Promise<Body | null> {
  try {
    return (await request.json()) as Body
  } catch {
    return null
  }
}

async function businessExists(supabase: ReturnType<typeof createAdminClient>, businessId: string) {
  const { data } = await supabase
    .from("businesses")
    .select("business_id")
    .eq("business_id", businessId)
    .eq("deleted", false)
    .maybeSingle()
  return !!data
}

/** Guarantee the business still has exactly one primary domain. */
async function ensurePrimary(supabase: ReturnType<typeof createAdminClient>, businessId: string) {
  const { data: rows } = await supabase
    .from("business_domains")
    .select("domain, is_primary")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true })

  if (!rows?.length) return
  if (rows.some((r) => r.is_primary)) return

  await supabase
    .from("business_domains")
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .eq("domain", rows[0].domain)
}

/** Clear the current primary so a new one can be set (partial unique index). */
async function clearPrimary(supabase: ReturnType<typeof createAdminClient>, businessId: string) {
  await supabase
    .from("business_domains")
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .eq("is_primary", true)
}

// ---------------------------------------------------------------------------
// GET /api/businesses/domains?business_id=… — list a business's domains.
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const businessId = new URL(request.url).searchParams.get("business_id")
  if (!businessId) return NextResponse.json({ error: "business_id is required" }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("business_domains")
    .select("domain, is_primary, is_active, label, created_at")
    .eq("business_id", businessId)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ domains: data ?? [] })
}

// ---------------------------------------------------------------------------
// POST /api/businesses/domains — add a domain to a business.
// Body: { business_id, domain, is_primary?, is_active?, label? }
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

  const businessId = typeof body.business_id === "string" ? body.business_id : ""
  if (!businessId) return NextResponse.json({ error: "business_id is required" }, { status: 400 })

  const domain = normalizeDomain(body.domain)
  if (!domain) {
    return NextResponse.json(
      { error: "domain is invalid or reserved (use a label like \"acme\" or a hostname like \"shop.acme.com\")" },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()
  if (!(await businessExists(supabase, businessId))) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 })
  }

  // A domain maps to exactly one tenant — it is the primary key of the table.
  const { data: taken } = await supabase
    .from("business_domains")
    .select("business_id")
    .eq("domain", domain)
    .maybeSingle()
  if (taken) {
    const mine = taken.business_id === businessId
    return NextResponse.json(
      { error: mine ? `"${domain}" is already on this business` : `"${domain}" is already taken` },
      { status: 409 },
    )
  }

  // First domain of a business is always primary, whatever the caller asked.
  const { count } = await supabase
    .from("business_domains")
    .select("domain", { count: "exact", head: true })
    .eq("business_id", businessId)
  const makePrimary = body.is_primary === true || (count ?? 0) === 0

  if (makePrimary) await clearPrimary(supabase, businessId)

  const { error } = await supabase.from("business_domains").insert({
    domain,
    business_id: businessId,
    is_primary: makePrimary,
    is_active: body.is_active === false ? false : true,
    label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : null,
  })
  if (error) {
    await ensurePrimary(supabase, businessId)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ domain, is_primary: makePrimary }, { status: 201 })
}

// ---------------------------------------------------------------------------
// PATCH /api/businesses/domains — update or rename a domain.
// Body: { business_id, domain, new_domain?, is_primary?, is_active?, label? }
// ---------------------------------------------------------------------------
export async function PATCH(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const body = await readJson(request)
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

  const businessId = typeof body.business_id === "string" ? body.business_id : ""
  const domain = typeof body.domain === "string" ? body.domain.trim().toLowerCase() : ""
  if (!businessId || !domain) {
    return NextResponse.json({ error: "business_id and domain are required" }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: existing } = await supabase
    .from("business_domains")
    .select("domain, business_id, is_primary, is_active, label")
    .eq("domain", domain)
    .eq("business_id", businessId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: "Domain not found on this business" }, { status: 404 })

  // --- rename: `domain` is the primary key, so replace the row -------------
  let targetDomain = existing.domain
  if ("new_domain" in body) {
    const renamed = normalizeDomain(body.new_domain)
    if (!renamed) return NextResponse.json({ error: "new_domain is invalid or reserved" }, { status: 400 })

    if (renamed !== existing.domain) {
      const { data: taken } = await supabase
        .from("business_domains")
        .select("business_id")
        .eq("domain", renamed)
        .maybeSingle()
      if (taken) return NextResponse.json({ error: `"${renamed}" is already taken` }, { status: 409 })
      targetDomain = renamed
    }
  }

  const nextPrimary = typeof body.is_primary === "boolean" ? body.is_primary : existing.is_primary
  const nextActive = typeof body.is_active === "boolean" ? body.is_active : existing.is_active
  const nextLabel =
    "label" in body ? (typeof body.label === "string" && body.label.trim() ? body.label.trim() : null) : existing.label

  // A deactivated domain resolves to nothing, so it must not stay primary.
  if (nextPrimary && !nextActive) {
    return NextResponse.json({ error: "The primary domain cannot be deactivated" }, { status: 400 })
  }

  if (nextPrimary) await clearPrimary(supabase, businessId)

  try {
    if (targetDomain !== existing.domain) {
      const { error: insErr } = await supabase.from("business_domains").insert({
        domain: targetDomain,
        business_id: businessId,
        is_primary: nextPrimary,
        is_active: nextActive,
        label: nextLabel,
      })
      if (insErr) throw new Error(insErr.message)

      const { error: delErr } = await supabase
        .from("business_domains")
        .delete()
        .eq("domain", existing.domain)
        .eq("business_id", businessId)
      if (delErr) throw new Error(delErr.message)
    } else {
      const { error } = await supabase
        .from("business_domains")
        .update({
          is_primary: nextPrimary,
          is_active: nextActive,
          label: nextLabel,
          updated_at: new Date().toISOString(),
        })
        .eq("domain", existing.domain)
        .eq("business_id", businessId)
      if (error) throw new Error(error.message)
    }
  } catch (err) {
    await ensurePrimary(supabase, businessId)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Update failed" }, { status: 500 })
  }

  await ensurePrimary(supabase, businessId)
  return NextResponse.json({ domain: targetDomain, is_primary: nextPrimary, is_active: nextActive })
}

// ---------------------------------------------------------------------------
// DELETE /api/businesses/domains?business_id=…&domain=… — remove a domain.
// The last remaining domain cannot be removed: a tenant with no domain is
// unreachable, because the host is the only way to resolve its business_id.
// ---------------------------------------------------------------------------
export async function DELETE(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const params = new URL(request.url).searchParams
  const businessId = params.get("business_id") ?? ""
  const domain = (params.get("domain") ?? "").trim().toLowerCase()
  if (!businessId || !domain) {
    return NextResponse.json({ error: "business_id and domain are required" }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { count } = await supabase
    .from("business_domains")
    .select("domain", { count: "exact", head: true })
    .eq("business_id", businessId)

  if ((count ?? 0) <= 1) {
    return NextResponse.json(
      { error: "A business must keep at least one domain — add the replacement first" },
      { status: 400 },
    )
  }

  const { error } = await supabase
    .from("business_domains")
    .delete()
    .eq("business_id", businessId)
    .eq("domain", domain)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await ensurePrimary(supabase, businessId)
  return NextResponse.json({ deleted: domain })
}
