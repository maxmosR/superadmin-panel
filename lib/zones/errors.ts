// Map a zone function's SQL error to the route's HTTP answer. The functions
// raise the bare code as the message (P0001/P0002/22023) and put extra data
// in DETAIL (PostgREST: `details`).
import type { ZoneIssue } from "./types"

export interface RpcError {
  message?: string
  code?: string
  details?: string | null
}

export interface MappedError {
  status: number
  body: Record<string, unknown>
}

function parseIssues(details: string | null | undefined): ZoneIssue[] {
  if (!details) return []
  try {
    const v = JSON.parse(details)
    return Array.isArray(v) ? (v as ZoneIssue[]) : []
  } catch {
    return []
  }
}

/**
 * `context` is logged on unexpected errors: ids and codes only (never names,
 * addresses or coordinates).
 */
export function mapZoneError(error: RpcError, context: { fn: string; business_id?: string }): MappedError {
  switch (error.message) {
    case "draft_changed":
      return { status: 409, body: { error: "draft_changed" } }
    case "publish_blocked":
    case "warnings_not_acknowledged":
      return { status: 422, body: { error: error.message, issues: parseIssues(error.details) } }
    case "invalid_payload":
      return { status: 400, body: { error: "invalid_payload", field: error.details ?? null } }
    case "not_found":
      return { status: 404, body: { error: "business_not_found" } }
    case "version_not_found":
      return { status: 404, body: { error: "version_not_found" } }
    case "zone_set_immutable":
      return { status: 409, body: { error: "zone_set_immutable" } }
  }
  console.error(
    JSON.stringify({ event: "zones_rpc_failed", fn: context.fn, business_id: context.business_id ?? null, code: error.code ?? null }),
  )
  return { status: 500, body: { error: "internal" } }
}
