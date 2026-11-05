// SMS sender aliases and usage: shared types and helpers for the /sms screens
// and their routes. Aliases live in sms_sender_aliases (written only by the
// operator-sms-alias / openapi-sms-webhook Edge Functions); every SMS is a
// sms_logs row.

export type AliasState = "PENDING" | "APPROVED" | "REJECTED" | "PATCH_REQUIRED" | "DELETING" | "DELETED"

export interface SmsAlias {
  id: string
  business_id: string
  environment: "sandbox" | "production"
  openapi_sender_id: string
  sender: string
  country_code: string
  state: AliasState
  reject_reason: string | null
  patch_requests: Array<{ reason: string; requestedAt: string | null }>
  registration_data: {
    pec?: string
    companyWebsite?: string
    industry?: string
    senderCompanyRelationship?: string
    trafficType?: string
  }
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export const ALIAS_SELECT =
  "id, business_id, environment, openapi_sender_id, sender, country_code, state, reject_reason, patch_requests, registration_data, last_synced_at, created_at, updated_at"

export interface SmsUsage {
  messages: number
  sms_parts: number
  delivered: number
  failed: number
  total_cost: number
}

export const EMPTY_USAGE: SmsUsage = { messages: 0, sms_parts: 0, delivered: 0, failed: 0, total_cost: 0 }

export interface SmsMessageRow {
  id: string
  purpose: string
  channel: string
  recipient: string | null
  sender: string | null
  status: string
  delivery_state: string | null
  error_code: string | null
  segment_count: number | null
  total_price: number | null
  provider_message_id: string | null
  requested_at: string
  sent_at: string | null
  delivered_at: string | null
}

/** "login" / "checkout" for the screens (sms_logs keeps sign_in / phone_change). */
export function purposeLabel(purpose: string): string {
  if (purpose === "sign_in") return "Login"
  if (purpose === "phone_change") return "Checkout"
  return purpose
}

/** A phone as the console shows it: country code and the last 3 digits only. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 6) return "•••"
  const cc = digits.startsWith("39") ? "+39" : `+${digits.slice(0, 2)}`
  return `${cc} ••• ••${digits.slice(-3)}`
}

/** The alias that matters for a restaurant: its live one, else its newest. */
export function currentAlias<T extends Pick<SmsAlias, "state" | "updated_at">>(aliases: T[]): T | null {
  const sorted = [...aliases].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return sorted.find((a) => a.state !== "DELETED" && a.state !== "REJECTED") ?? sorted[0] ?? null
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Europe/Rome UTC offset (e.g. "+01:00") on a given calendar day. */
function romeOffset(day: string): string {
  const noon = new Date(`${day}T12:00:00Z`)
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", timeZoneName: "shortOffset" })
    .formatToParts(noon)
    .find((p) => p.type === "timeZoneName")?.value
  const h = Number(/GMT([+-]\d+)/.exec(tz ?? "")?.[1] ?? 1)
  return `${h >= 0 ? "+" : "-"}${String(Math.abs(h)).padStart(2, "0")}:00`
}

/** Midnight in Rome at the start of `day` (YYYY-MM-DD), as an ISO timestamp. */
export function romeDayStart(day: string): string | null {
  if (!DAY_RE.test(day) || Number.isNaN(new Date(`${day}T00:00:00Z`).getTime())) return null
  return `${day}T00:00:00${romeOffset(day)}`
}

/** The day after `day` (YYYY-MM-DD). */
export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Today in Rome, YYYY-MM-DD. */
export function romeToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(now)
}

/** The first day of the current Rome month, YYYY-MM-DD. */
export function romeMonthStartDay(now = new Date()): string {
  return `${romeToday(now).slice(0, 7)}-01`
}

/**
 * A date range from query params (inclusive days, Rome time) as the
 * [from, to) timestamps sms_usage_totals takes. Missing ends are open.
 * Undefined when a given day is malformed.
 */
export function rangeFromParams(from: string | null, to: string | null): { from: string | null; to: string | null } | undefined {
  const f = from ? romeDayStart(from) : null
  const t = to ? romeDayStart(nextDay(to)) : null
  if ((from && !f) || (to && (!DAY_RE.test(to) || !t))) return undefined
  return { from: f, to: t }
}

/** SMS prices have up to 4 decimals (e.g. 0,0450 €). */
export function formatEuro(n: number | null | undefined, locale = "it-IT"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n ?? 0)
}

/**
 * True when a query failed because this database doesn't have the SMS alias
 * migration (20261104120000_sms_sender_aliases) yet.
 */
export function isMissingSmsSchema(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false
  return ["42P01", "42703", "42883", "PGRST202", "PGRST204", "PGRST205"].includes(e.code ?? "") ||
    /sms_sender_aliases|sms_usage_totals|delivery_state|whatsapp_number/.test(e.message ?? "")
}

export const MISSING_SMS_SCHEMA_ERROR =
  "This database doesn't have the SMS sender migration yet (20261104120000_sms_sender_aliases). It arrives with the next backend deploy."

/**
 * What removing an alias deletes, by state (same rule as the Edge Function's
 * removalAtOpenApi). The environment is only known server-side: an alias of
 * the other environment is never deleted at OpenAPI, and the answer says so.
 *   deleted  Approved / Needs correction: deleted at OpenAPI too
 *   kept     In review / Deleting: OpenAPI refuses, it stays on the account
 *   none     Rejected / Deleted: nothing left at OpenAPI
 */
export function removalPlan(state: AliasState): "deleted" | "kept" | "none" {
  if (state === "REJECTED" || state === "DELETED") return "none"
  if (state === "APPROVED" || state === "PATCH_REQUIRED") return "deleted"
  return "kept"
}
