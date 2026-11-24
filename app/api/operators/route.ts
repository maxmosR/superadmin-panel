// Platform operators.
//   GET                          every platform_admins row
//   PATCH { user_id, is_active }  activate / deactivate an operator
// The last active operator can't be deactivated (nobody could undo it), and
// nobody deactivates themselves (409 cannot_deactivate_self: another operator
// must). Every change is audited first (record_audit, ids only); without the
// audit row nothing is changed (500 audit_failed).
//
// The last-operator check runs twice: before the update (the usual refusal)
// and again after it, because two operators deactivating each other at the
// same moment would both pass the first check. If the update left no active
// operator, it is rolled back (the target is reactivated, audited as such)
// and the request answers 409 last_operator. Each statement commits on its
// own, so whichever request re-checks last sees both updates and undoes its
// own: at least one operator always stays active. (A single SQL function
// that locks the active rows would make this a single atomic step.)
import { NextResponse } from "next/server"
import { recordOperatorAudit } from "@/lib/operator-audit"
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

  const targetUserId = body.user_id.toLowerCase()
  if (!body.is_active && targetUserId === guard.admin.userId.toLowerCase()) {
    return NextResponse.json({ error: "cannot_deactivate_self" }, { status: 409 })
  }

  const supabase = createAdminClient()
  if (!body.is_active) {
    const { data: active, error } = await supabase.from("platform_admins").select("user_id").eq("is_active", true)
    if (error) return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
    const remaining = (active ?? []).filter((r) => r.user_id !== body.user_id)
    if (remaining.length === 0) return NextResponse.json({ error: "last_operator" }, { status: 409 })
  }

  const audit = await recordOperatorAudit(supabase, {
    action: body.is_active ? "operator_activated" : "operator_deactivated",
    actorUserId: guard.admin.userId,
    subjectUserId: body.user_id,
  })
  if (!audit.ok) return NextResponse.json({ error: "audit_failed" }, { status: 500 })

  const { data, error } = await supabase
    .from("platform_admins")
    .update({ is_active: body.is_active })
    .eq("user_id", body.user_id)
    .select("user_id, is_active")
    .maybeSingle()
  if (error || !data) {
    // The audit row stays (an attempt); this links it to the outcome.
    console.error(JSON.stringify({ event: "operator_active_update_failed", audit: audit.id, code: error?.code ?? null, found: !!data }))
    if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 })
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  if (!body.is_active) {
    const { data: after, error: afterError } = await supabase.from("platform_admins").select("user_id").eq("is_active", true)
    // Unknown is treated like "none left": undo rather than risk zero.
    if (afterError || (after ?? []).length === 0) {
      return rollbackDeactivation(supabase, guard.admin.userId, body.user_id, audit.id, afterError?.code ?? null)
    }
  }
  return NextResponse.json({ ok: true, operator: data })
}

async function rollbackDeactivation(
  supabase: ReturnType<typeof createAdminClient>,
  actorUserId: string,
  targetUserId: string,
  auditId: string,
  recheckCode: string | null,
) {
  // Best effort: the reactivation must happen even if its audit row can't be written.
  const undoAudit = await recordOperatorAudit(supabase, {
    action: "operator_activated",
    actorUserId,
    subjectUserId: targetUserId,
    detail: { reason: "last_operator_rollback", reverts_audit: auditId },
  })
  const { error } = await supabase.from("platform_admins").update({ is_active: true }).eq("user_id", targetUserId)
  console.error(
    JSON.stringify({
      event: "operator_deactivation_rolled_back",
      audit: auditId,
      undo_audit: undoAudit.ok ? undoAudit.id : null,
      recheck_code: recheckCode,
      rollback_code: error?.code ?? null,
    }),
  )
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 })
  return NextResponse.json({ error: "last_operator" }, { status: 409 })
}
