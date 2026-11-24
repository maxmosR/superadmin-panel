import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { normalizeDomain } from "@/lib/domains"
import { parseConfigFields, parseContactFields } from "@/lib/business-fields"
import { auditFailedResponse, recordOperatorAudit } from "@/lib/operator-audit"
import { SLUG_RE, assignRoleAsOperator, findOrCreateIdentity, parseIdentifier, parseWhatsapp } from "@/lib/roles"
import { NO_ZONES, zoneBadges, type ZoneSetRow } from "@/lib/zones/badge"
import { isUuid } from "@/lib/zones/validate"

export const dynamic = "force-dynamic"

// ---------------------------------------------------------------------------
// businesses.whatsapp_number arrives with migration 20261104120000. Until a
// database has it, reading treats every number as unset, clearing is a no-op,
// and setting one answers a clear error instead of failing the whole request.
// ---------------------------------------------------------------------------
const MISSING_COLUMN = new Set(["42703", "PGRST204"])
const isMissingColumn = (e: { code?: string; message?: string } | null) =>
  !!e && (MISSING_COLUMN.has(e.code ?? "") || /whatsapp_number/.test(e.message ?? ""))

async function readWhatsappNumbers(supabase: ReturnType<typeof createAdminClient>): Promise<Map<string, string>> {
  const { data, error } = await supabase.from("businesses").select("business_id, whatsapp_number").eq("deleted", false)
  if (error) {
    if (!isMissingColumn(error)) console.error(JSON.stringify({ event: "whatsapp_read_failed", code: error.code ?? null }))
    return new Map()
  }
  return new Map(
    (data ?? [])
      .filter((r: { whatsapp_number: string | null }) => !!r.whatsapp_number)
      .map((r: { business_id: string; whatsapp_number: string }) => [r.business_id, r.whatsapp_number]),
  )
}

/**
 * Sets or clears the WhatsApp number. Returns an error code, or null:
 * `whatsapp_unavailable` until the database has the column (migration
 * 20261104120000_sms_sender_aliases), `save_failed` otherwise (logged by code).
 */
async function writeWhatsapp(supabase: ReturnType<typeof createAdminClient>, businessId: string, value: string | null): Promise<string | null> {
  const { error } = await supabase.from("businesses").update({ whatsapp_number: value }).eq("business_id", businessId)
  if (!error) return null
  if (isMissingColumn(error)) return value === null ? null : "whatsapp_unavailable"
  console.error(JSON.stringify({ event: "whatsapp_write_failed", business: businessId, code: error.code ?? null }))
  return "save_failed"
}

/** A failed write step: logged by its database code, answered with a stable one. */
class StepError extends Error {
  constructor(
    readonly step: string,
    readonly dbCode: string | null,
    readonly answer: string = "save_failed",
  ) {
    super(step)
  }
}
const stepError = (step: string, e: { code?: string } | null | undefined, answer?: string) =>
  new StepError(step, e?.code ?? null, answer)

// ---------------------------------------------------------------------------
// GET /api/businesses — list all businesses with domains, owners count and readiness.
// ---------------------------------------------------------------------------
// Optional ?business_id=<uuid>: just that restaurant (the setup page).
export async function GET(request?: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const only = request ? new URL(request.url).searchParams.get("business_id") : null
  if (only !== null && !isUuid(only)) return NextResponse.json({ error: "invalid_business_id" }, { status: 400 })

  const supabase = createAdminClient()
  let query = supabase
    .from("businesses")
    .select(
      "business_id, slug, business_name, name_abbreviation, tax_id, address, phone, email, logo_url, " +
        "sms_sender_name, email_from_name, order_notification_email, created_at, deleted, " +
        "business_domains(domain, is_primary, is_active, label), " +
        "business_configurations(timezone, currency, minimum_charge, max_concurrent_appointments, open_days_and_hours, payment_methods), " +
        "user_roles(user_id, role)",
    )
    .eq("deleted", false)
    .order("created_at", { ascending: false })
  if (only) query = query.eq("business_id", only)
  const { data, error } = await query

  if (error) {
    console.error(JSON.stringify({ event: "businesses_read_failed", code: error.code ?? null }))
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  }

  // WhatsApp numbers, read on their own: a database without the
  // sms_sender_aliases migration has no such column, and that must not stop
  // the business list from loading.
  const whatsappBy = await readWhatsappNumbers(supabase)

  // Delivery zone badges: one query for every restaurant's draft and live set.
  let zoneQuery = supabase
    .from("delivery_zone_sets")
    .select("business_id, status, version, based_on_version, created_at, updated_at")
    .in("status", ["draft", "published"])
  if (only) zoneQuery = zoneQuery.eq("business_id", only)
  const { data: zoneRows, error: zoneErr } = await zoneQuery
  if (zoneErr) console.error(JSON.stringify({ event: "zone_badges_failed", code: zoneErr.code ?? null }))
  const badges = zoneBadges((zoneRows ?? []) as ZoneSetRow[])

  // Stripe connected accounts (no secrets in the table).
  let payoutQuery = supabase
    .from("payout_accounts")
    .select("business_id, stripe_account_id, charges_enabled, payouts_enabled, details_submitted, requirements")
  if (only) payoutQuery = payoutQuery.eq("business_id", only)
  const { data: payoutRows, error: payoutErr } = await payoutQuery
  if (payoutErr) console.error(JSON.stringify({ event: "payout_accounts_failed", code: payoutErr.code ?? null }))
  const payouts = new Map<string, any>((payoutRows ?? []).map((p: any) => [p.business_id, p]))

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
      // Mirror of the APPROVED SMS alias (sms_sender_aliases), read-only here.
      sms_sender_name: b.sms_sender_name ?? null,
      whatsapp_number: whatsappBy.get(b.business_id) ?? null,
      email_from_name: b.email_from_name ?? null,
      order_notification_email: b.order_notification_email ?? null,
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
      payout_account: payoutSummary(payouts.get(b.business_id)),
    }
  })

  return NextResponse.json({ businesses })
}

function payoutSummary(p: any) {
  if (!p) return null
  const req = (p.requirements ?? {}) as { currently_due?: unknown[]; past_due?: unknown[] }
  const due = new Set([...(req.currently_due ?? []), ...(req.past_due ?? [])])
  return {
    stripe_account_id: p.stripe_account_id as string,
    charges_enabled: !!p.charges_enabled,
    payouts_enabled: !!p.payouts_enabled,
    details_submitted: !!p.details_submitted,
    outstanding_requirements: due.size,
  }
}

// ---------------------------------------------------------------------------
// POST /api/businesses — provision a business and its first owner.
// Body: { business_name, name_abbreviation, slug, subdomain,
//         owner_identifier, owner_kind: "phone"|"email",
//         whatsapp_number?, email_from_name?, …contact/config fields }
// The SMS sender is not set here: it is the restaurant's APPROVED alias,
// registered from the SMS screen (/sms).
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
  const whatsapp = parseWhatsapp(body.whatsapp_number)
  const emailFromName =
    typeof body.email_from_name === "string" && body.email_from_name.trim() ? body.email_from_name.trim().slice(0, 80) : null

  const errors: string[] = []
  if (!businessName) errors.push("business_name is required")
  if (!nameAbbreviation) errors.push("name_abbreviation is required")
  if (!SLUG_RE.test(slug)) errors.push("slug must be 3–40 characters: a-z, 0-9 and -")
  if (!subdomain) errors.push("subdomain is invalid or reserved")
  if (!owner) errors.push("a valid owner phone or email is required")
  if (whatsapp === undefined) errors.push("whatsapp_number must be an international number, e.g. +39 333 123 4567")
  if (errors.length) return NextResponse.json({ error: errors.join("; ") }, { status: 400 })
  const contact = parseContactFields(body)
  if (!contact.ok) return NextResponse.json({ error: contact.error }, { status: 400 })
  const config = parseConfigFields(body)
  if (!config.ok) return NextResponse.json({ error: config.error }, { status: 400 })
  const minimumCharge = Number(body.minimum_charge ?? 0)
  const maxConcurrent = Number(body.max_concurrent_appointments ?? 6)
  if (!Number.isFinite(minimumCharge) || minimumCharge < 0 || minimumCharge > 100000) {
    return NextResponse.json({ error: "invalid_minimum_charge" }, { status: 400 })
  }
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 1000) {
    return NextResponse.json({ error: "invalid_max_concurrent_appointments" }, { status: 400 })
  }

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
  if (!identity) return NextResponse.json({ error: "owner_identity_failed" }, { status: 500 })

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
        email_from_name: emailFromName,
        tax_id: contact.values.tax_id ?? null,
        address: contact.values.address ?? null,
        phone: contact.values.phone ?? null,
        email: contact.values.email ?? (owner?.kind === "email" ? owner.email : null),
        logo_url: contact.values.logo_url ?? null,
      })
      .select("business_id")
      .single()
    if (bizErr || !biz) throw stepError("business", bizErr, "create_failed")
    businessId = biz.business_id as string

    if (whatsapp) {
      const waErr = await writeWhatsapp(supabase, businessId, whatsapp)
      if (waErr) throw new StepError("whatsapp", null, waErr)
    }

    const { error: configErr } = await supabase.from("business_configurations").insert({
      business_id: businessId,
      timezone: config.values.timezone ?? "Europe/Rome",
      currency: config.values.currency ?? "EUR",
      minimum_charge: minimumCharge,
      max_concurrent_appointments: maxConcurrent,
      open_days_and_hours: config.values.open_days_and_hours ?? null,
    })
    if (configErr) throw stepError("configuration", configErr, "create_failed")

    const { error: domainErr } = await supabase.from("business_domains").insert({
      domain: subdomain,
      business_id: businessId,
      is_primary: true,
      is_active: true,
    })
    if (domainErr) throw stepError("domain", domainErr, "create_failed")

    const assigned = await assignRoleAsOperator(supabase, guard.admin.userId, businessId, identity.userId, "owner")
    if (assigned.status !== 200) {
      const code = typeof assigned.body.error === "string" && /^[a-z_]{1,64}$/.test(assigned.body.error) ? assigned.body.error : "owner_assignment_failed"
      throw new StepError("owner", null, code)
    }

    return NextResponse.json({ business_id: businessId, slug, subdomain, owner: { user_id: identity.userId } }, { status: 201 })
  } catch (err) {
    await rollback()
    const step = err instanceof StepError ? err : new StepError("unexpected", null, "create_failed")
    console.error(JSON.stringify({ event: "business_create_failed", step: step.step, code: step.dbCode, operator: guard.admin.userId }))
    return NextResponse.json({ error: step.answer }, { status: 500 })
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

  const businessId = isUuid(body.business_id) ? body.business_id : ""
  if (!businessId) return NextResponse.json({ error: "business_id is required" }, { status: 400 })
  if ("slug" in body) return NextResponse.json({ error: "slug is immutable" }, { status: 400 })

  // Check every field before writing anything.
  const contact = parseContactFields(body)
  if (!contact.ok) return NextResponse.json({ error: contact.error }, { status: 400 })
  const config = parseConfigFields(body)
  if (!config.ok) return NextResponse.json({ error: config.error }, { status: 400 })
  let whatsapp: string | null | undefined
  if ("whatsapp_number" in body) {
    whatsapp = parseWhatsapp(body.whatsapp_number)
    if (whatsapp === undefined) {
      return NextResponse.json({ error: "whatsapp_number must be an international number, e.g. +39 333 123 4567" }, { status: 400 })
    }
  }
  let subdomain: string | null = null
  if ("subdomain" in body) {
    subdomain = normalizeDomain(body.subdomain)
    if (!subdomain) return NextResponse.json({ error: "subdomain is invalid or reserved" }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Make sure the business exists (and is not soft-deleted).
  const { data: existing, error: existErr } = await supabase
    .from("businesses")
    .select("business_id")
    .eq("business_id", businessId)
    .eq("deleted", false)
    .maybeSingle()
  if (existErr) {
    console.error(JSON.stringify({ event: "business_read_failed", business: businessId, code: existErr.code ?? null }))
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: "Business not found" }, { status: 404 })

  try {
    // --- businesses -------------------------------------------------------
    const bizUpdate: Record<string, unknown> = {}
    if (typeof body.business_name === "string" && body.business_name.trim())
      bizUpdate.business_name = body.business_name.trim()
    if (typeof body.name_abbreviation === "string" && body.name_abbreviation.trim())
      bizUpdate.name_abbreviation = body.name_abbreviation.trim()
    Object.assign(bizUpdate, contact.values)
    if (whatsapp !== undefined) {
      const waErr = await writeWhatsapp(supabase, businessId, whatsapp)
      if (waErr) return NextResponse.json({ error: waErr }, { status: waErr === "whatsapp_unavailable" ? 409 : 500 })
    }
    if ("email_from_name" in body) {
      const v = typeof body.email_from_name === "string" ? body.email_from_name.trim().slice(0, 80) : ""
      bizUpdate.email_from_name = v || null
    }
    if (Object.keys(bizUpdate).length) {
      bizUpdate.updated_at = new Date().toISOString()
      const { error } = await supabase.from("businesses").update(bizUpdate).eq("business_id", businessId)
      if (error) throw stepError("business", error, "update_failed")
    }

    // --- business_configurations (update existing, insert if missing) -----
    const configUpdate: Record<string, unknown> = { ...config.values }
    if ("minimum_charge" in body) configUpdate.minimum_charge = Number(body.minimum_charge) || 0
    if ("max_concurrent_appointments" in body)
      configUpdate.max_concurrent_appointments = Number(body.max_concurrent_appointments) || 6
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
        if (error) throw stepError("configuration", error, "update_failed")
      } else {
        const { error } = await supabase
          .from("business_configurations")
          .insert({ business_id: businessId, ...configUpdate })
        if (error) throw stepError("configuration", error, "update_failed")
      }
    }

    // --- domains ----------------------------------------------------------
    // A business owns MANY domains; they are added, renamed, re-pointed and
    // removed through /api/businesses/domains. The legacy single `subdomain`
    // field is still accepted here and applied to the PRIMARY domain so older
    // callers keep working.
    if (subdomain) {
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

        const audit = await recordOperatorAudit(supabase, {
          action: "subdomain_changed",
          actorUserId: guard.admin.userId,
          businessId,
          detail: { domain: subdomain, previous_domain: current?.domain ?? null },
        })
        if (!audit.ok) return auditFailedResponse()

        // `domain` is the primary key, so a rename is an insert + delete.
        const { error: insErr } = await supabase
          .from("business_domains")
          .insert({ domain: subdomain, business_id: businessId, is_primary: !current, is_active: true })
        if (insErr && insErr.code !== "23505") throw stepError("subdomain", insErr, "update_failed")

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
        if (primErr) throw stepError("subdomain", primErr, "update_failed")
      }
    }

    return NextResponse.json({ business_id: businessId, updated: true })
  } catch (err) {
    const step = err instanceof StepError ? err : new StepError("unexpected", null, "update_failed")
    console.error(JSON.stringify({ event: "business_update_failed", business: businessId, step: step.step, code: step.dbCode }))
    return NextResponse.json({ error: step.answer }, { status: 500 })
  }
}
