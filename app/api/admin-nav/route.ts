import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { ADMIN_NAV_ITEMS, parseHiddenItems } from "@/lib/admin-nav"

export const dynamic = "force-dynamic"

/**
 * Which admin-panel sections each restaurant sees (`business_admin_nav`).
 *
 *   GET /api/admin-nav  every section, and every restaurant with its hidden
 *       sections (no row = nothing hidden)
 *   PUT /api/admin-nav  { business_id, hidden_items: string[] }  replaces one
 *       restaurant's hidden list. The admin panel applies it on its next
 *       request (sidebar, pages and API routes).
 */

const UUID_RE = /^[0-9a-f-]{36}$/i

export async function GET() {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const supabase = createAdminClient()
  const [{ data: businesses, error: bizError }, { data: navRows, error: navError }] = await Promise.all([
    supabase.from("businesses").select("business_id, business_name, slug").eq("deleted", false).order("business_name"),
    supabase.from("business_admin_nav").select("business_id, hidden_items"),
  ])
  if (bizError || navError) {
    return NextResponse.json({ error: (bizError ?? navError)?.message ?? "load_failed" }, { status: 500 })
  }

  const hidden = new Map((navRows ?? []).map((r) => [r.business_id as string, (r.hidden_items as string[]) ?? []]))
  return NextResponse.json({
    items: ADMIN_NAV_ITEMS,
    businesses: (businesses ?? []).map((b) => ({
      business_id: b.business_id,
      business_name: b.business_name,
      slug: b.slug,
      hidden_items: hidden.get(b.business_id as string) ?? [],
    })),
  })
}

export async function PUT(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const businessId = String(body.business_id ?? "")
  if (!UUID_RE.test(businessId)) return NextResponse.json({ error: "business_id is required" }, { status: 400 })

  let hiddenItems: string[]
  try {
    hiddenItems = parseHiddenItems(body.hidden_items)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("business_admin_nav")
    .upsert(
      { business_id: businessId, hidden_items: hiddenItems, updated_by: guard.admin.userId },
      { onConflict: "business_id" },
    )
    .select("hidden_items")
    .single()
  if (error) {
    // 23503: no such restaurant.
    const status = error.code === "23503" ? 404 : 500
    return NextResponse.json({ error: status === 404 ? "business_not_found" : error.message }, { status })
  }
  return NextResponse.json({ business_id: businessId, hidden_items: data.hidden_items })
}
