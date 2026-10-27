// Hand-written input checks for the zone routes (no validation library, like
// lib/admin-nav.ts). They mirror delivery_zone_validate_payload() in the
// database, so a bad body gets 400 before any RPC; the database still checks.
import { ZONE_LIMITS, type CutLineInput, type DraftPayload, type LatLng, type RingInput, type RuleInput, type RuleMode } from "./types"

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v)
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)

export function parseLatLng(v: unknown): LatLng | null {
  if (!v || typeof v !== "object") return null
  const { lat, lng } = v as Record<string, unknown>
  if (!isNum(lat) || !isNum(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

/** A fee in euros: 0–999.99, at most 2 decimals. */
export function isValidFee(v: unknown): v is number {
  return isNum(v) && v >= 0 && v <= ZONE_LIMITS.maxFee && Math.abs(Math.round(v * 100) - v * 100) < 1e-6
}

/** A ring's minimum order in euros: 0–9999.99, at most 2 decimals (0 = none). */
export function isValidMinOrder(v: unknown): v is number {
  return isNum(v) && v >= 0 && v <= ZONE_LIMITS.maxMinOrder && Math.abs(Math.round(v * 100) - v * 100) < 1e-6
}

/** Non-negative integer (draft revision). */
export function parseRevision(v: unknown): number | null {
  return Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null
}

/** Published version number (1, 2, …). */
export function parseVersion(v: unknown): number | null {
  const n = typeof v === "string" && /^\d{1,9}$/.test(v) ? Number(v) : v
  return Number.isInteger(n) && (n as number) >= 1 ? (n as number) : null
}

function parseLabel(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null
  if (typeof v !== "string" || v.length > ZONE_LIMITS.maxLabel) return undefined
  const t = v.trim()
  return t === "" ? null : t
}

function parseId(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null
  return isUuid(v) ? v : undefined
}

export type PayloadCheck = { ok: true; payload: DraftPayload } | { ok: false; field: string }

/** Validate an authored zone state (save body or imported JSON). */
export function parseDraftPayload(body: unknown): PayloadCheck {
  const bad = (field: string): PayloadCheck => ({ ok: false, field })
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("$")
  const b = body as Record<string, unknown>

  const origin = parseLatLng(b.origin)
  if (!origin) return bad("origin")

  if (!Array.isArray(b.rings) || b.rings.length > ZONE_LIMITS.maxRings) return bad("rings")
  const rings: RingInput[] = []
  const seen = new Set<number>()
  for (const [i, r] of b.rings.entries()) {
    if (!r || typeof r !== "object") return bad(`rings[${i}]`)
    const { radius_m, fee, min_order, label } = r as Record<string, unknown>
    if (!Number.isInteger(radius_m) || (radius_m as number) < ZONE_LIMITS.minRadiusM || (radius_m as number) > ZONE_LIMITS.maxRadiusM || seen.has(radius_m as number)) {
      return bad(`rings[${i}].radius_m`)
    }
    seen.add(radius_m as number)
    if (!isValidFee(fee)) return bad(`rings[${i}].fee`)
    // Absent or null (files exported before minimums existed): no minimum.
    const minOrder = min_order === undefined || min_order === null ? 0 : min_order
    if (!isValidMinOrder(minOrder)) return bad(`rings[${i}].min_order`)
    const l = parseLabel(label)
    if (l === undefined) return bad(`rings[${i}].label`)
    rings.push({ radius_m: radius_m as number, fee, min_order: minOrder, label: l })
  }

  const rawLines = b.cut_lines ?? []
  if (!Array.isArray(rawLines) || rawLines.length > ZONE_LIMITS.maxLines) return bad("cut_lines")
  const cut_lines: CutLineInput[] = []
  for (const [i, c] of rawLines.entries()) {
    if (!c || typeof c !== "object") return bad(`cut_lines[${i}]`)
    const { id, label, points } = c as Record<string, unknown>
    const pid = parseId(id)
    if (pid === undefined) return bad(`cut_lines[${i}].id`)
    const l = parseLabel(label)
    if (l === undefined) return bad(`cut_lines[${i}].label`)
    if (!Array.isArray(points) || points.length < 2 || points.length > ZONE_LIMITS.maxPoints) return bad(`cut_lines[${i}].points`)
    const pts: LatLng[] = []
    for (const [j, p] of points.entries()) {
      const ll = parseLatLng(p)
      if (!ll) return bad(`cut_lines[${i}].points[${j}]`)
      pts.push(ll)
    }
    cut_lines.push({ id: pid, label: l, points: pts })
  }

  const rawRules = b.rules ?? []
  if (!Array.isArray(rawRules) || rawRules.length > ZONE_LIMITS.maxRules) return bad("rules")
  const rules: RuleInput[] = []
  for (const [i, u] of rawRules.entries()) {
    if (!u || typeof u !== "object") return bad(`rules[${i}]`)
    const { id, anchor, mode, fee, label } = u as Record<string, unknown>
    const pid = parseId(id)
    if (pid === undefined) return bad(`rules[${i}].id`)
    const a = parseLatLng(anchor)
    if (!a) return bad(`rules[${i}].anchor`)
    if (mode !== "ring_fee" && mode !== "custom_fee" && mode !== "excluded") return bad(`rules[${i}].mode`)
    if (mode === "custom_fee" ? !isValidFee(fee) : fee !== null && fee !== undefined) return bad(`rules[${i}].fee`)
    const l = parseLabel(label)
    if (l === undefined) return bad(`rules[${i}].label`)
    rules.push({ id: pid, anchor: a, mode: mode as RuleMode, fee: mode === "custom_fee" ? (fee as number) : null, label: l })
  }

  return { ok: true, payload: { origin, rings, cut_lines, rules } }
}
