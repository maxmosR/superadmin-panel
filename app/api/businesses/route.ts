import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { normalizeDomain } from "@/lib/domains"

export const dynamic = "force-dynamic"

// ---------------------------------------------------------------------------
// GET /api/businesses — list all businesses with domain + owner.
// ---------------------------------------------------------------------------
export async function GET() {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("businesses")
    .select(
      "business_id, business_name, name_abbreviation, tax_id, address, phone, email, logo_url, created_at, deleted, " +
        "business_domains(domain, is_primary, is_active, label), " +
        "business_configurations(timezone, currency, minimum_charge, max_concurrent_appointments, open_days_and_hours), " +
        // Disambiguate: businesses<->profiles has 3 FKs (business_id, created_by,
        // updated_by). Embed via the tenant link (profiles.business_id).
        "profiles!profiles_business_id_fkey(user_id, email, role, first_name, last_name)",
    )
    .eq("deleted", false)
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const businesses = (data ?? []).map((b: any) => ({
    business_id: b.business_id,
    business_name: b.business_name,
    name_abbreviation: b.name_abbreviation,
    tax_id: b.tax_id,
    address: b.address,
    phone: b.phone,
    email: b.email,
    logo_url: b.logo_url,
    created_at: b.created_at,
    domains: (b.business_domains ?? []).slice().sort((x: any, y: any) =>
      x.is_primary === y.is_primary ? String(x.domain).localeCompare(String(y.domain)) : x.is_primary ? -1 : 1,
    ),
    // Back-compat single value: the primary domain (or the first one there is).
    domain:
      (b.business_domains ?? []).find((d: any) => d.is_primary)?.domain ??
      b.business_domains?.[0]?.domain ??
      null,
    config: b.business_configurations?.[0] ?? null,
    owner: (b.profiles ?? []).find((p: any) => p.role === "owner") ?? null,
  }))

  return NextResponse.json({ businesses })
}

// ---------------------------------------------------------------------------
// POST /api/businesses — provision a business + owner account.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // --- Validate -----------------------------------------------------------
  const businessName = typeof body.business_name === "string" ? body.business_name.trim() : ""
  const nameAbbreviation = typeof body.name_abbreviation === "string" ? body.name_abbreviation.trim() : ""
  const ownerEmail = typeof body.owner_email === "string" ? body.owner_email.trim().toLowerCase() : ""
  const ownerPassword = typeof body.owner_password === "string" ? body.owner_password : ""
  const subdomain = normalizeDomain(body.subdomain)

  const errors: string[] = []
  if (!businessName) errors.push("business_name is required")
  if (!nameAbbreviation) errors.push("name_abbreviation is required")
  if (!ownerEmail || !ownerEmail.includes("@")) errors.push("a valid owner_email is required")
  if (!ownerPassword || ownerPassword.length < 8) errors.push("owner_password must be at least 8 characters")
  if (!subdomain) errors.push("subdomain is invalid or reserved")
  if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 400 })

  const supabase = createAdminClient()

  // --- Uniqueness checks --------------------------------------------------
  const { data: existingDomain } = await supabase
    .from("business_domains")
    .select("domain")
    .eq("domain", subdomain)
    .maybeSingle()
  if (existingDomain) {
    return NextResponse.json({ error: `Subdomain "${subdomain}" is already taken` }, { status: 409 })
  }

  // --- Create owner auth user --------------------------------------------
  const { data: created, error: createUserErr } = await supabase.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
    user_metadata: { role: "owner" },
  })
  if (createUserErr || !created?.user) {
    const msg = createUserErr?.message || "Failed to create owner account"
    const status = /already been registered|already exists/i.test(msg) ? 409 : 500
    return NextResponse.json({ error: msg }, { status })
  }
  const ownerUserId = created.user.id

  // Track what we created so we can roll back on any later failure.
  let businessId: string | null = null

  const rollback = async () => {
    // FKs to businesses do NOT cascade for domains/config — delete in reverse.
    if (businessId) {
      await supabase.from("business_domains").delete().eq("business_id", businessId)
      await supabase.from("business_configurations").delete().eq("business_id", businessId)
      await supabase.from("profiles").delete().eq("business_id", businessId)
      await supabase.from("businesses").delete().eq("business_id", businessId)
    }
    await supabase.auth.admin.deleteUser(ownerUserId)
  }

  try {
    // --- businesses -------------------------------------------------------
    const { data: biz, error: bizErr } = await supabase
      .from("businesses")
      .insert({
        business_name: businessName,
        name_abbreviation: nameAbbreviation,
        tax_id: body.tax_id ?? null,
        address: body.address ?? null,
        phone: body.phone ?? null,
        email: body.email ?? ownerEmail,
        logo_url: body.logo_url ?? null,
      })
      .select("business_id")
      .single()
    if (bizErr || !biz) throw new Error(bizErr?.message || "Failed to create business")
    businessId = biz.business_id

    // --- profiles (owner) -------------------------------------------------
    const { error: profileErr } = await supabase.from("profiles").insert({
      user_id: ownerUserId,
      business_id: businessId,
      first_name: body.owner_first_name ?? null,
      last_name: body.owner_last_name ?? null,
      role: "owner",
      email: ownerEmail,
      is_active: true,
      created_from_admin_panel: true,
    })
    if (profileErr) throw new Error(profileErr.message)

    // --- business_configurations -----------------------------------------
    const { error: configErr } = await supabase.from("business_configurations").insert({
      business_id: businessId,
      timezone: body.timezone ?? "Europe/Rome",
      currency: body.currency ?? "EUR",
      minimum_charge: body.minimum_charge ?? 0,
      max_concurrent_appointments: body.max_concurrent_appointments ?? 6,
      open_days_and_hours: body.open_days_and_hours ?? null,
    })
    if (configErr) throw new Error(configErr.message)

    // --- business_domains (subdomain -> tenant) --------------------------
    const { error: domainErr } = await supabase.from("business_domains").insert({
      domain: subdomain,
      business_id: businessId,
      is_primary: true,
      is_active: true,
    })
    if (domainErr) throw new Error(domainErr.message)

    return NextResponse.json(
      {
        business_id: businessId,
        subdomain,
        owner: { user_id: ownerUserId, email: ownerEmail },
      },
      { status: 201 },
    )
  } catch (err) {
    await rollback()
    const message = err instanceof Error ? err.message : "Provisioning failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/businesses — update an existing business.
// Body: { business_id, ...editable fields }. All fields optional except id.
// ---------------------------------------------------------------------------
export async function PATCH(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const businessId = typeof body.business_id === "string" ? body.business_id : ""
  if (!businessId) return NextResponse.json({ error: "business_id is required" }, { status: 400 })

  const supabase = createAdminClient()

  // Make sure the business exists (and is not soft-deleted).
  const { data: existing, error: existErr } = await supabase
    .from("businesses")
    .select("business_id")
    .eq("business_id", businessId)
    .eq("deleted", false)
    .maybeSingle()
  if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: "Business not found" }, { status: 404 })

  try {
    // --- businesses -------------------------------------------------------
    const bizUpdate: Record<string, unknown> = {}
    if (typeof body.business_name === "string" && body.business_name.trim())
      bizUpdate.business_name = body.business_name.trim()
    if (typeof body.name_abbreviation === "string" && body.name_abbreviation.trim())
      bizUpdate.name_abbreviation = body.name_abbreviation.trim()
    if ("tax_id" in body) bizUpdate.tax_id = body.tax_id || null
    if ("address" in body) bizUpdate.address = body.address || null
    if ("phone" in body) bizUpdate.phone = body.phone || null
    if ("email" in body) bizUpdate.email = body.email || null
    if ("logo_url" in body) bizUpdate.logo_url = body.logo_url || null
    if (Object.keys(bizUpdate).length) {
      bizUpdate.updated_at = new Date().toISOString()
      const { error } = await supabase.from("businesses").update(bizUpdate).eq("business_id", businessId)
      if (error) throw new Error(error.message)
    }

    // --- business_configurations (update existing, insert if missing) -----
    const configUpdate: Record<string, unknown> = {}
    if ("timezone" in body) configUpdate.timezone = body.timezone || "Europe/Rome"
    if ("currency" in body) configUpdate.currency = body.currency || "EUR"
    if ("minimum_charge" in body) configUpdate.minimum_charge = Number(body.minimum_charge) || 0
    if ("max_concurrent_appointments" in body)
      configUpdate.max_concurrent_appointments = Number(body.max_concurrent_appointments) || 6
    if ("open_days_and_hours" in body) configUpdate.open_days_and_hours = body.open_days_and_hours ?? null
    if (Object.keys(configUpdate).length) {
      const { data: cfg } = await supabase
        .from("business_configurations")
        .select("config_id")
        .eq("business_id", businessId)
        .maybeSingle()
      if (cfg) {
        configUpdate.updated_at = new Date().toISOString()
        const { error } = await supabase
          .from("business_configurations")
          .update(configUpdate)
          .eq("business_id", businessId)
        if (error) throw new Error(error.message)
      } else {
        const { error } = await supabase
          .from("business_configurations")
          .insert({ business_id: businessId, ...configUpdate })
        if (error) throw new Error(error.message)
      }
    }

    // --- domains ----------------------------------------------------------
    // A business owns MANY domains; they are added, renamed, re-pointed and
    // removed through /api/businesses/domains. The legacy single `subdomain`
    // field is still accepted here and applied to the PRIMARY domain so older
    // callers keep working.
    if ("subdomain" in body) {
      const subdomain = normalizeDomain(body.subdomain)
      if (!subdomain) throw new Error("subdomain is invalid or reserved")

      const { data: current } = await supabase
        .from("business_domains")
        .select("domain")
        .eq("business_id", businessId)
        .eq("is_primary", true)
        .maybeSingle()

      if (current?.domain !== subdomain) {
        const { data: taken } = await supabase
          .from("business_domains")
          .select("business_id")
          .eq("domain", subdomain)
          .maybeSingle()
        if (taken && taken.business_id !== businessId) {
          return NextResponse.json({ error: `Subdomain "${subdomain}" is already taken` }, { status: 409 })
        }

        // `domain` is the primary key, so a rename is an insert + delete.
        const { error: insErr } = await supabase
          .from("business_domains")
          .insert({ domain: subdomain, business_id: businessId, is_primary: !current, is_active: true })
        if (insErr && insErr.code !== "23505") throw new Error(insErr.message)

        if (current?.domain) {
          await supabase
            .from("business_domains")
            .update({ is_primary: false })
            .eq("business_id", businessId)
            .eq("domain", current.domain)
          await supabase
            .from("business_domains")
            .delete()
            .eq("business_id", businessId)
            .eq("domain", current.domain)
        }

        const { error: primErr } = await supabase
          .from("business_domains")
          .update({ is_primary: true, is_active: true, updated_at: new Date().toISOString() })
          .eq("business_id", businessId)
          .eq("domain", subdomain)
        if (primErr) throw new Error(primErr.message)
      }
    }

    // --- optional owner password reset ------------------------------------
    if (typeof body.owner_password === "string" && body.owner_password.length > 0) {
      if (body.owner_password.length < 8) throw new Error("owner_password must be at least 8 characters")
      const { data: owner } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("business_id", businessId)
        .eq("role", "owner")
        .maybeSingle()
      if (owner?.user_id) {
        const { error } = await supabase.auth.admin.updateUserById(owner.user_id, {
          password: body.owner_password,
        })
        if (error) throw new Error(error.message)
      }
    }

    return NextResponse.json({ business_id: businessId, updated: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
