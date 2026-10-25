// Platform operators.
//   GET                          every platform_admins row
//   PATCH { user_id, is_active }  activate / deactivate an operator
// The last active operator can't be deactivated (nobody could undo it).
import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("platform_admins")
    .select("user_id, email, is_active, created_at")
    .order("created_at", { ascending: true })
  if (error) return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  return NextResponse.json({ operators: data ?? [], me: guard.admin.userId })
}

export async function PATCH(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  if (typeof body.user_id !== "string" || !UUID_RE.test(body.user_id) || typeof body.is_active !== "boolean") {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }

  const supabase = createAdminClient()
  if (!body.is_active) {
    const { data: active, error } = await supabase.from("platform_admins").select("user_id").eq("is_active", true)
    if (error) return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
    const remaining = (active ?? []).filter((r) => r.user_id !== body.user_id)
    if (remaining.length === 0) return NextResponse.json({ error: "last_operator" }, { status: 409 })
  }

  const { data, error } = await supabase
    .from("platform_admins")
    .update({ is_active: body.is_active })
    .eq("user_id", body.user_id)
    .select("user_id, is_active")
    .maybeSingle()
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 })
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json({ ok: true, operator: data })
}
