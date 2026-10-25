import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"

// Operator-side identity + role helpers (Phase 8). Roles live only in
// user_roles and are written only through set_role_assignment, which
// re-checks the operator, serializes per restaurant and refuses to leave a
// restaurant without an owner. Nothing here writes profiles.role or
// profiles.business_id.

export const STAFF_ROLES = ["owner", "sala_boss", "worker", "accountant"] as const
export type StaffRole = (typeof STAFF_ROLES)[number]
export const isStaffRole = (v: unknown): v is StaffRole =>
  typeof v === "string" && (STAFF_ROLES as readonly string[]).includes(v)

export const SLUG_RE = /^[a-z0-9-]{3,40}$/
/** OpenAPI.com accepts 3–11 characters; the database 1–11. */
export const SMS_SENDER_RE = /^[A-Za-z0-9 ]{3,11}$/

export type Identifier = { kind: "phone"; e164: string } | { kind: "email"; email: string }

/** Phone (E.164, +39 default) or email. */
export function parseIdentifier(kind: unknown, raw: unknown): Identifier | null {
  if (typeof raw !== "string") return null
  if (kind === "email") {
    const email = raw.trim().toLowerCase()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? { kind: "email", email } : null
  }
  if (kind !== "phone") return null
  let p = raw.trim().replace(/[\s().-]/g, "")
  if (p.startsWith("00")) p = `+${p.slice(2)}`
  if (!p.startsWith("+")) p = `+39${p}`
  return /^\+[1-9][0-9]{6,14}$/.test(p) && p !== "+000000000000" ? { kind: "phone", e164: p } : null
}

/**
 * The existing account for the identifier, or a new unconfirmed one (the
 * person signs in with a code). `created` tells the caller whether to delete
 * it again on rollback.
 */
export async function findOrCreateIdentity(
  admin: SupabaseClient,
  id: Identifier,
): Promise<{ userId: string; created: boolean } | null> {
  const column = id.kind === "phone" ? "phone_number" : "email"
  const value = id.kind === "phone" ? id.e164 : id.email
  const { data: found } = await admin
    .from("profiles")
    .select("user_id")
    .eq(column, value)
    .eq("created_from_admin_panel", false)
    .maybeSingle()
  if (found?.user_id) return { userId: found.user_id as string, created: false }

  const attrs = id.kind === "phone" ? { phone: id.e164, phone_confirm: false } : { email: id.email, email_confirm: false }
  const { data, error } = await admin.auth.admin.createUser(attrs)
  if (data?.user?.id) return { userId: data.user.id, created: true }
  if (error) console.error(JSON.stringify({ event: "operator_create_identity_failed", status: error.status ?? null }))
  return null
}

export async function assignRoleAsOperator(
  admin: SupabaseClient,
  operatorUserId: string,
  businessId: string,
  userId: string,
  role: StaffRole | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data, error } = await admin.rpc("set_role_assignment", {
    p_actor: operatorUserId,
    p_actor_kind: "operator",
    p_business_id: businessId,
    p_user_id: userId,
    p_role: role,
  })
  if (!error) return { status: 200, body: { ok: true, action: (data as { action?: string } | null)?.action ?? null } }
  if (error.message === "last_owner") return { status: 409, body: { error: "last_owner" } }
  if (error.message === "not_operator") return { status: 403, body: { error: "not_operator" } }
  if (error.code === "P0002") return { status: 404, body: { error: "not_found" } }
  console.error(JSON.stringify({ event: "operator_assign_failed", code: error.code }))
  return { status: 500, body: { error: "assign_failed" } }
}
