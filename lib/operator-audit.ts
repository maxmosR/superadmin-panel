import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"

// Audit trail for privileged operator actions that no SQL function audits on
// its own. Role changes are NOT here: set_role_assignment writes
// user_role_events in the same transaction (lib/roles.ts).
//
// Writes go through the backend's shared public.record_audit(...) (service
// role only, SECURITY DEFINER) into public.personal_data_audit_log, the same
// function the retention sweep uses (../BirraOra-three-month-test/supabase/
// functions/_shared/record-audit.ts). The action values below must exist in
// public.personal_data_audit_action_enum — they are added by a backend
// migration; until it is deployed record_audit refuses them and the audited
// routes answer 500 audit_failed (fail closed, by design).
//
// Ids only: actor = the operator's user id, subject = the target user id,
// detail = business id / source. Never emails, phones or names.

export const OPERATOR_AUDIT_ACTIONS = [
  "operator_activated",
  "operator_deactivated",
  "staff_email_changed",
] as const
export type OperatorAuditAction = (typeof OPERATOR_AUDIT_ACTIONS)[number]

export type OperatorAuditInput = {
  action: OperatorAuditAction
  /** The operator performing the action (platform_admins.user_id). */
  actorUserId: string
  /** The account the action is applied to. */
  subjectUserId: string
  /** The restaurant, when the action is scoped to one. */
  businessId?: string | null
}

export type OperatorAuditResult = { ok: true; id: string } | { ok: false }

/**
 * Write one audit row. Callers run it BEFORE the mutation and refuse the
 * request when it fails, so no audited change happens without a row. (A row
 * whose mutation then fails can exist: the trail may over-report an attempt,
 * never under-report a change.)
 */
export async function recordOperatorAudit(admin: SupabaseClient, input: OperatorAuditInput): Promise<OperatorAuditResult> {
  const detail: Record<string, string> = { source: "superadmin-panel" }
  if (input.businessId) detail.business_id = input.businessId
  const { data, error } = await admin.rpc("record_audit", {
    p_action: input.action,
    p_actor: input.actorUserId,
    p_subject_user_id: input.subjectUserId,
    p_request_id: null,
    p_detail: detail,
  })
  if (error || data === null || data === undefined) {
    console.error(
      JSON.stringify({ event: "operator_audit_failed", action: input.action, code: error?.code ?? null, operator: input.actorUserId }),
    )
    return { ok: false }
  }
  return { ok: true, id: String(data) }
}
