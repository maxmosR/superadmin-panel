import { fmt } from "./core"
import type { Messages } from "./messages"

/**
 * One readable sentence for a failed console API call. Known codes get the
 * shared wording; anything else keeps its code so it can still be reported.
 * `extra` holds a screen's own codes (e.g. "last_owner").
 */
export function apiError(t: Messages, code: unknown, status?: number, extra?: Record<string, string>): string {
  const c = typeof code === "string" ? code : ""
  if (c && extra?.[c]) return extra[c]
  if (c === "unauthenticated" || status === 401) return t.common.unauthenticated
  if (c === "not_operator" || status === 403) return t.common.notOperator
  if (c === "not_found" || c === "business_not_found") return t.common.notFound
  if (c) return c
  return status ? fmt(t.common.requestFailed, { status }) : t.common.network
}
