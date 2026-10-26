import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { normalizeDomain } from "@/lib/domains"
import { SLUG_RE, SMS_SENDER_RE, assignRoleAsOperator, findOrCreateIdentity, parseIdentifier } from "@/lib/roles"
import { NO_ZONES, zoneBadges, type ZoneSetRow } from "@/lib/zones/badge"

export const dynamic = "force-dynamic"

// ---------------------------------------------------------------------------
// GET /api/businesses — list all businesses with domains, owners count and readiness.
// ---------------------------------------------------------------------------
export async function GET() {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("businesses")
    .select(
      "business_id, slug, business_name, name_abbreviation, tax_id, address, phone, email, logo_url, " +
        "sms_sender_name, email_from_name, created_at, deleted, " +
        "business_domains(domain, is_primary, is_active, label), " +
        "business_configurations(timezone, currency, minimum_charge, max_concurrent_appointments, open_days_and_hours), " +
        "user_roles(user_id, role)",
    )
    .eq("deleted", false)
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Delivery zone badges: one query for every restaurant's draft and live set.
  const { data: zoneRows, error: zoneErr } = await supabase
    .from("delivery_zone_sets")
    .select("business_id, status, version, based_on_version, created_at, updated_at")
    .in("status", ["draft", "published"])
  if (zoneErr) console.error(JSON.stringify({ event: "zone_badges_failed", code: zoneErr.code ?? null }))
  const badges = zoneBadges((zoneRows ?? []) as ZoneSetRow[])

  const businesses = (data ?? []).map((b: any) => {
    const owners = (b.user_roles ?? []).filter((r: any) => r.role === "owner")
    return {
      business_id: b.business_id,
      slug: b.slug,
      business_name: b.business_name,
      name_abbreviation: b.name_abbreviation,
      tax_id: b.tax_id,
      address: b.address,
      phone: b.phone,
      email: b.email,
      logo_url: b.logo_url,
      sms_sender_name: b.sms_sender_name ?? null,
      email_from_name: b.email_from_name ?? null,
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
      // Roles come from user_roles; profiles.role is deprecated.
      owner_count: owners.length,
      staff_count: (b.user_roles ?? []).length,
      readiness: { has_owner: owners.length > 0, sms_sender_set: !!b.sms_sender_name },
      zones: badges.get(b.business_id) ?? NO_ZONES,
    }
  })

  return NextResponse.json({ businesses })
}

// ---------------------------------------------------------------------------
// POST /api/businesses — provision a business and its first owner.
// Body: { business_name, name_abbreviation, slug, subdomain,
//         owner_identifier, owner_kind: "phone"|"email",
//         sms_sender_name?, email_from_name?, …contact/config fields }
// The owner is found or pre-created by phone/email (no password; they sign
// in with a code) and made owner through set_role_assignment. The slug is
// immutable once created.
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
  const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : ""
  const subdomain = normalizeDomain(body.subdomain)
  const owner = parseIdentifier(body.owner_kind, body.owner_identifier)
  const smsSender = typeof body.sms_sender_name === "string" && body.sms_sender_name.trim() ? body.sms_sender_name.trim() : null
  const emailFromName =
    typeof body.email_from_name === "string" && body.email_from_name.trim() ? body.email_from_name.trim().slice(0, 80) : null

  const errors: string[] = []
  if (!businessName) errors.push("business_name is required")
  if (!nameAbbreviation) errors.push("name_abbreviation is required")
  if (!SLUG_RE.test(slug)) errors.push("slug must be 3–40 characters: a-z, 0-9 and -")
  if (!subdomain) errors.push("subdomain is invalid or reserved")
  if (!owner) errors.push("a valid owner phone or email is required")
  if (smsSender && !SMS_SENDER_RE.test(smsSender)) errors.push("sms_sender_name must be 3–11 letters, digits or spaces")
  if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 400 })

  const supabase = createAdminClient()

  // --- Uniqueness checks --------------------------------------------------
  const [{ data: existingDomain }, { data: existingSlug }] = await Promise.all([
    supabase.from("business_domains").select("domain").eq("domain", subdomain).maybeSingle(),
    supabase.from("businesses").select("business_id").eq("slug", slug).maybeSingle(),
  ])
  if (existingDomain) {
    return NextResponse.json({ error: `Subdomain "${subdomain}" is already taken` }, { status: 409 })
  }
  if (existingSlug) {
    return NextResponse.json({ error: `Slug "${slug}" is already taken` }, { status: 409 })
  }

  // --- Owner identity (existing account, or a new unconfirmed one) --------
  const identity = await findOrCreateIdentity(supabase, owner as NonNullable<typeof owner>)
  if (!identity) return NextResponse.json({ error: "Could not create the owner identity" }, { status: 500 })

  let businessId: string | null = null
  const rollback = async () => {
    // Domains and config don't cascade; user_roles does.
    if (businessId) {
      await supabase.from("business_domains").delete().eq("business_id", businessId)
      await supabase.from("business_configurations").delete().eq("business_id", businessId)
      await supabase.from("businesses").delete().eq("business_id", businessId)
    }
    if (identity.created) await supabase.auth.admin.deleteUser(identity.userId)
  }

  try {
    const { data: biz, error: bizErr } = await supabase
      .from("businesses")
      .insert({
        business_name: businessName,
        name_abbreviation: nameAbbreviation,
        slug,
        sms_sender_name: smsSender,
        email_from_name: emailFromName,
        tax_id: body.tax_id ?? null,
        address: body.address ?? null,
        phone: body.phone ?? null,
        email: body.email ?? (owner?.kind === "email" ? owner.email : null),
        logo_url: body.logo_url ?? null,
      })
      .select("business_id")
      .single()
    if (bizErr || !biz) throw new Error(bizErr?.message || "Failed to create business")
    businessId = biz.business_id as string

    const { error: configErr } = await supabase.from("business_configurations").insert({
      business_id: businessId,
      timezone: body.timezone ?? "Europe/Rome",
      currency: body.currency ?? "EUR",
      minimum_charge: body.minimum_charge ?? 0,
      max_concurrent_appointments: body.max_concurrent_appointments ?? 6,
      open_days_and_hours: body.open_days_and_hours ?? null,
    })
    if (configErr) throw new Error(configErr.message)

    const { error: domainErr } = await supabase.from("business_domains").insert({
      domain: subdomain,
      business_id: businessId,
      is_primary: true,
      is_active: true,
    })
    if (domainErr) throw new Error(domainErr.message)

    const assigned = await assignRoleAsOperator(supabase, guard.admin.userId, businessId, identity.userId, "owner")
    if (assigned.status !== 200) throw new Error(String(assigned.body.error ?? "owner assignment failed"))

    return NextResponse.json({ business_id: businessId, slug, subdomain, owner: { user_id: identity.userId } }, { status: 201 })
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
    if ("sms_sender_name" in body) {
      const v = typeof body.sms_sender_name === "string" ? body.sms_sender_name.trim() : ""
      if (v && !SMS_SENDER_RE.test(v)) {
        return NextResponse.json({ error: "sms_sender_name must be 3–11 letters, digits or spaces" }, { status: 400 })
      }
      bizUpdate.sms_sender_name = v || null
    }
    if ("email_from_name" in body) {
      const v = typeof body.email_from_name === "string" ? body.email_from_name.trim().slice(0, 80) : ""
      bizUpdate.email_from_name = v || null
    }
    if ("slug" in body) {
      return NextResponse.json({ error: "slug is immutable" }, { status: 400 })
    }
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

    return NextResponse.json({ business_id: businessId, updated: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
