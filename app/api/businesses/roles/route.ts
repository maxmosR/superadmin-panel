// Staff and owners of one restaurant, managed by an operator.
//   GET    ?business_id=…                          role assignments (masked identifiers)
//   POST   { business_id, identifier, kind, role } add (finds or pre-creates the identity)
//   PATCH  { business_id, user_id, role }          change
//   DELETE { business_id, user_id }                remove
// All writes through set_role_assignment (last-owner guard → 409).
import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { assignRoleAsOperator, findOrCreateIdentity, isStaffRole, parseIdentifier } from "@/lib/roles"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v)

const maskPhone = (p: string | null) => {
  if (!p) return null
  const d = p.replace(/\D/g, "")
  return d.length < 4 ? "***" : `+${"*".repeat(d.length - 4)}${d.slice(-4)}`
}
const maskEmail = (e: string | null) => {
  if (!e) return null
  const [u, dom] = e.split("@")
  return dom ? `${u.slice(0, 1)}***@${dom}` : "***"
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  return ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
}

export async function GET(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const businessId = new URL(request.url).searchParams.get("business_id")
  if (!isUuid(businessId)) return NextResponse.json({ error: "business_id is required" }, { status: 400 })

  const supabase = createAdminClient()
  const { data: roles, error } = await supabase
    .from("user_roles")
    .select("user_id, role, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: true })
  if (error) return NextResponse.json({ error: "lookup_failed" }, { status: 500 })

  const ids = (roles ?? []).map((r) => r.user_id as string)
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("user_id, first_name, last_name, phone_number, email").in("user_id", ids)
    : { data: [] as Array<Record<string, unknown>> }
  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]))
  return NextResponse.json({
    members: (roles ?? []).map((r) => {
      const p = byId.get(r.user_id as string)
      return {
        user_id: r.user_id,
        role: r.role,
        granted_at: r.created_at,
        first_name: (p?.first_name as string | null) ?? null,
        last_name: (p?.last_name as string | null) ?? null,
        phone: maskPhone((p?.phone_number as string | null) ?? null),
        email: maskEmail((p?.email as string | null) ?? null),
      }
    }),
  })
}

export async function POST(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const b = await readBody(request)
  if (!isUuid(b.business_id) || !isStaffRole(b.role)) return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  const id = parseIdentifier(b.kind, b.identifier)
  if (!id) return NextResponse.json({ error: "invalid_identifier" }, { status: 400 })

  const supabase = createAdminClient()
  const identity = await findOrCreateIdentity(supabase, id)
  if (!identity) return NextResponse.json({ error: "assign_failed" }, { status: 500 })
  const r = await assignRoleAsOperator(supabase, guard.admin.userId, b.business_id, identity.userId, b.role)
  return NextResponse.json(r.status === 200 ? { ok: true } : r.body, { status: r.status })
}

export async function PATCH(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const b = await readBody(request)
  if (!isUuid(b.business_id) || !isUuid(b.user_id) || !isStaffRole(b.role)) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }
  const supabase = createAdminClient()
  const r = await assignRoleAsOperator(supabase, guard.admin.userId, b.business_id, b.user_id, b.role)
  return NextResponse.json(r.body, { status: r.status })
}

export async function DELETE(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const b = await readBody(request)
  if (!isUuid(b.business_id) || !isUuid(b.user_id)) return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  const supabase = createAdminClient()
  const r = await assignRoleAsOperator(supabase, guard.admin.userId, b.business_id, b.user_id, null)
  return NextResponse.json(r.body, { status: r.status })
}
