// Checks for the restaurant fields /api/businesses writes as they are sent
// (contact details and configuration). Hand-written like lib/zones/validate.ts.
// Each parser returns the value to store (null = clear) or `undefined` when the
// input is refused; the route answers 400 `invalid_<field>`.

const CONTROL = /[\u0000-\u001f\u007f]/

/** Optional free text: trimmed, empty → null, at most `max` characters, no control characters. */
function text(v: unknown, max: number): string | null | undefined {
  if (v === null || v === undefined) return null
  if (typeof v !== "string") return undefined
  const s = v.trim()
  if (!s) return null
  if (s.length > max || CONTROL.test(s)) return undefined
  return s
}

export const FIELD_LIMITS = {
  tax_id: 32,
  address: 300,
  phone: 32,
  email: 254,
  url: 2048,
  timezone: 64,
  /** Serialized open_days_and_hours, in characters. */
  hours: 8192,
  slotsPerDay: 6,
} as const

export function parseTaxId(v: unknown): string | null | undefined {
  const s = text(v, FIELD_LIMITS.tax_id)
  if (s === undefined) return undefined
  if (s !== null && !/^[A-Za-z0-9 .\-/]+$/.test(s)) return undefined
  return s
}

export function parseAddress(v: unknown): string | null | undefined {
  return text(v, FIELD_LIMITS.address)
}

/** A display phone number: digits with the usual separators, 3–32 characters. */
export function parsePhone(v: unknown): string | null | undefined {
  const s = text(v, FIELD_LIMITS.phone)
  if (s === undefined) return undefined
  if (s !== null && !/^\+?[0-9][0-9 ()./-]{2,31}$/.test(s)) return undefined
  return s
}

export function parseEmail(v: unknown): string | null | undefined {
  const s = text(v, FIELD_LIMITS.email)
  if (s === undefined) return undefined
  if (s !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return undefined
  return s === null ? null : s.toLowerCase()
}

/** An absolute https: URL without credentials (shown as an <img> by the apps). */
export function parseHttpsUrl(v: unknown): string | null | undefined {
  const s = text(v, FIELD_LIMITS.url)
  if (s === undefined || s === null) return s
  let url: URL
  try {
    url = new URL(s)
  } catch {
    return undefined
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return undefined
  return url.toString()
}

/** A valid IANA time zone name, e.g. "Europe/Rome" (or "UTC"). */
export function isTimeZone(v: unknown): v is string {
  if (typeof v !== "string" || v.length > FIELD_LIMITS.timezone) return false
  if (!/^(?:UTC|[A-Za-z][A-Za-z_]*(?:\/[A-Za-z0-9_+-]+){1,2})$/.test(v)) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: v })
    return true
  } catch {
    return false
  }
}

/** ISO 4217 style: three letters, stored upper case. */
export function parseCurrency(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined
  const s = v.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(s) ? s : undefined
}

// ---------------------------------------------------------------------------
// open_days_and_hours — the shape the storefront (lib/utils/business-hours.ts)
// and the admin panel (app/dashboard/business/page.tsx) read: an object keyed
// by weekday, each day either
//   { is_open, open: "HH:MM", close: "HH:MM" | "HH:MM+1" }           (current)
//   { is_open, slots: [{ open, close, close_in_the_day_after? }] }  (legacy)
// (the admin panel also reads a day-level close_in_the_day_after flag).
// ---------------------------------------------------------------------------
export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const

const TIME = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/
const CLOSE = /^(?:[01][0-9]|2[0-3]):[0-5][0-9](?:\+1)?$/
const DAY_KEYS = new Set(["is_open", "open", "close", "slots", "close_in_the_day_after"])
const SLOT_KEYS = new Set(["open", "close", "close_in_the_day_after"])

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype

function validSlot(v: unknown): boolean {
  if (!isPlainObject(v)) return false
  if (Object.keys(v).some((k) => !SLOT_KEYS.has(k))) return false
  if (typeof v.open !== "string" || !TIME.test(v.open)) return false
  if (typeof v.close !== "string" || !CLOSE.test(v.close)) return false
  return v.close_in_the_day_after === undefined || typeof v.close_in_the_day_after === "boolean"
}

function validDay(v: unknown): boolean {
  if (!isPlainObject(v)) return false
  if (Object.keys(v).some((k) => !DAY_KEYS.has(k))) return false
  if (v.is_open !== undefined && typeof v.is_open !== "boolean") return false
  if (v.open !== undefined && v.open !== null && (typeof v.open !== "string" || !TIME.test(v.open))) return false
  if (v.close !== undefined && v.close !== null && (typeof v.close !== "string" || !CLOSE.test(v.close))) return false
  if (v.close_in_the_day_after !== undefined && typeof v.close_in_the_day_after !== "boolean") return false
  if (v.slots !== undefined && v.slots !== null) {
    if (!Array.isArray(v.slots) || v.slots.length > FIELD_LIMITS.slotsPerDay || !v.slots.every(validSlot)) return false
  }
  return true
}

/** null (no hours set) or a week schedule; `undefined` when refused. */
export function parseOpenDaysAndHours(v: unknown): Record<string, unknown> | null | undefined {
  if (v === null || v === undefined) return null
  if (!isPlainObject(v)) return undefined
  const keys = Object.keys(v)
  if (keys.some((k) => !(WEEKDAYS as readonly string[]).includes(k))) return undefined
  if (!keys.every((k) => validDay(v[k]))) return undefined
  if (JSON.stringify(v).length > FIELD_LIMITS.hours) return undefined
  return v
}

// ---------------------------------------------------------------------------
// Request bodies.
// ---------------------------------------------------------------------------
type Parsed = { ok: true; values: Record<string, unknown> } | { ok: false; error: string }

const CONTACT_PARSERS: Record<string, (v: unknown) => unknown> = {
  tax_id: parseTaxId,
  address: parseAddress,
  phone: parsePhone,
  email: parseEmail,
  logo_url: parseHttpsUrl,
}

/** The contact columns present in `body`, checked (null = clear). */
export function parseContactFields(body: Record<string, unknown>): Parsed {
  const values: Record<string, unknown> = {}
  for (const [key, parse] of Object.entries(CONTACT_PARSERS)) {
    if (!(key in body)) continue
    const v = parse(body[key])
    if (v === undefined) return { ok: false, error: `invalid_${key}` }
    values[key] = v
  }
  return { ok: true, values }
}

/**
 * The checked configuration columns present in `body`. An empty timezone or
 * currency falls back to Europe/Rome / EUR, as before.
 */
export function parseConfigFields(body: Record<string, unknown>): Parsed {
  const values: Record<string, unknown> = {}
  if ("timezone" in body) {
    const tz = typeof body.timezone === "string" ? body.timezone.trim() : body.timezone
    if (tz === null || tz === undefined || tz === "") values.timezone = "Europe/Rome"
    else if (isTimeZone(tz)) values.timezone = tz
    else return { ok: false, error: "invalid_timezone" }
  }
  if ("currency" in body) {
    const c = body.currency
    if (c === null || c === undefined || c === "") values.currency = "EUR"
    else {
      const parsed = parseCurrency(c)
      if (!parsed) return { ok: false, error: "invalid_currency" }
      values.currency = parsed
    }
  }
  if ("open_days_and_hours" in body) {
    const hours = parseOpenDaysAndHours(body.open_days_and_hours)
    if (hours === undefined) return { ok: false, error: "invalid_open_days_and_hours" }
    values.open_days_and_hours = hours
  }
  return { ok: true, values }
}
