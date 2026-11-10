// Change the sign-in email of someone on a restaurant's staff (operator).
//   PUT { business_id, user_id, email }
// The person must hold a role at that restaurant. The email is their one
// sign-in identity (admin panel, storefront, every restaurant), so it must
// not belong to another account. Set confirmed: the operator vouches for it,
// and the next code goes to the new address. profiles.email follows through
// the on_auth_user_updated_profile trigger.
import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { parseIdentifier } from "@/lib/roles"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v)

export async function PUT(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const b = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  if (!isUuid(b.business_id) || !isUuid(b.user_id)) return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  const id = parseIdentifier("email", b.email)
  if (!id || id.kind !== "email") return NextResponse.json({ error: "invalid_email" }, { status: 400 })

  const admin = createAdminClient()

  const { data: role, error: roleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("business_id", b.business_id)
    .eq("user_id", b.user_id)
    .maybeSingle()
  if (roleError) return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  if (!role) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const { data: current, error: getError } = await admin.auth.admin.getUserById(b.user_id)
  if (getError || !current?.user) return NextResponse.json({ error: "not_found" }, { status: 404 })
  if ((current.user.email ?? "").toLowerCase() === id.email) return NextResponse.json({ ok: true, unchanged: true })

  const { data: taken, error: takenError } = await admin
    .from("profiles")
    .select("user_id")
    .eq("email", id.email)
    .eq("created_from_admin_panel", false)
    .neq("user_id", b.user_id)
    .limit(1)
  if (takenError) return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  if (taken && taken.length > 0) return NextResponse.json({ error: "email_taken" }, { status: 409 })

  const { error } = await admin.auth.admin.updateUserById(b.user_id, { email: id.email, email_confirm: true })
  if (error) {
    // Auth's own uniqueness check (an account the profiles mirror missed).
    if (error.status === 422 || /already|exists|registered/i.test(error.message ?? "")) {
      return NextResponse.json({ error: "email_taken" }, { status: 409 })
    }
    console.error(JSON.stringify({ event: "operator_staff_email_failed", status: error.status ?? null }))
    return NextResponse.json({ error: "update_failed" }, { status: 500 })
  }

  console.info(
    JSON.stringify({ event: "operator_staff_email_changed", operator: guard.admin.userId, business: b.business_id, user: b.user_id }),
  )
  return NextResponse.json({ ok: true })
}
