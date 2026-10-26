import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { isUuid } from "@/lib/zones/validate"
import { mapZoneError } from "@/lib/zones/errors"
import { NO_ZONES, zoneBadges, type ZoneSetRow } from "@/lib/zones/badge"
import type { ZoneVersionRow } from "@/lib/zones/types"

export const dynamic = "force-dynamic"

/**
 * GET /api/zones?business_id=  everything the zone editor needs for one
 * restaurant: the business, its draft and published zone sets (authored
 * state + computed pieces), and the version history.
 */
export async function GET(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const businessId = new URL(request.url).searchParams.get("business_id")
  if (!isUuid(businessId)) return NextResponse.json({ error: "invalid_business_id" }, { status: 400 })

  const supabase = createAdminClient()
  const { data: business, error: bizErr } = await supabase
    .from("businesses")
    .select("business_id, business_name, slug, address, latitude, longitude, deleted")
    .eq("business_id", businessId)
    .maybeSingle()
  if (bizErr) return NextResponse.json(mapZoneError(bizErr, { fn: "businesses", business_id: businessId }).body, { status: 500 })
  if (!business || business.deleted) return NextResponse.json({ error: "business_not_found" }, { status: 404 })

  const [draft, published, sets] = await Promise.all([
    supabase.rpc("get_delivery_zone_set_geojson", { p_business_id: businessId, p_which: "draft" }),
    supabase.rpc("get_delivery_zone_set_geojson", { p_business_id: businessId, p_which: "published" }),
    supabase
      .from("delivery_zone_sets")
      .select("business_id, version, status, based_on_version, published_at, published_by, created_at, updated_at")
      .eq("business_id", businessId)
      .order("version", { ascending: false }),
  ])
  for (const [fn, r] of [["get_delivery_zone_set_geojson", draft], ["get_delivery_zone_set_geojson", published], ["delivery_zone_sets", sets]] as const) {
    if (r.error) {
      const m = mapZoneError(r.error, { fn, business_id: businessId })
      return NextResponse.json(m.body, { status: m.status })
    }
  }

  const rows = (sets.data ?? []) as Array<ZoneSetRow & { published_at: string | null; published_by: string | null }>
  const publisherIds = [...new Set(rows.map((r) => r.published_by).filter((v): v is string => !!v))]
  const emails = new Map<string, string | null>()
  if (publisherIds.length) {
    const { data: admins } = await supabase.from("platform_admins").select("user_id, email").in("user_id", publisherIds)
    for (const a of admins ?? []) emails.set(a.user_id as string, (a.email as string | null) ?? null)
  }
  const versions: ZoneVersionRow[] = rows
    .filter((r) => r.status === "published" || r.status === "archived")
    .map((r) => ({
      version: r.version,
      status: r.status as ZoneVersionRow["status"],
      published_at: r.published_at,
      published_by: r.published_by,
      published_by_email: r.published_by ? (emails.get(r.published_by) ?? null) : null,
    }))

  const { deleted: _deleted, ...biz } = business
  void _deleted
  return NextResponse.json({
    business: biz,
    draft: draft.data ?? null,
    published: published.data ?? null,
    versions,
    zones: zoneBadges(rows).get(businessId) ?? NO_ZONES,
  })
}
