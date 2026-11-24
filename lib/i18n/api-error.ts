import { fmt } from "./core"
import type { Messages } from "./messages"

const SERVER_CODES = new Set(["lookup_failed", "save_failed", "create_failed", "update_failed", "delete_failed"])

/**
 * One readable sentence for a failed console API call. Known codes get the
 * shared wording; anything else keeps its code so it can still be reported.
 * `extra` holds a screen's own codes (e.g. "last_owner").
 */
export function apiError(t: Messages, code: unknown, status?: number, extra?: Record<string, string>): string {
  const c = typeof code === "string" ? code : ""
  if (c && extra?.[c]) return extra[c]
  if (c === "unauthenticated" || status === 401) return t.common.unauthenticated
  if (c === "mfa_required") return t.common.mfaRequired
  if (c === "bad_origin") return t.common.badOrigin
  if (c === "not_operator" || (status === 403 && !c)) return t.common.notOperator
  if (c === "not_found" || c === "business_not_found") return t.common.notFound
  if (c === "audit_failed") return t.common.auditFailed
  if (SERVER_CODES.has(c)) return fmt(t.common.serverError, { code: c })
  if (c) return c
  return status ? fmt(t.common.requestFailed, { status }) : t.common.network
}
