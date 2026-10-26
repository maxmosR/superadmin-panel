// The editor's authored state (what the operator typed and drew), and its
// conversion to the save payload. Pure functions: unit-tested in node.
import { feeInput, formatKm, parseEuro, parseKm } from "./units"
import { parseDraftPayload } from "./validate"
import type { CutLineInput, DraftPayload, LatLng, RuleInput, ZoneSetView } from "./types"

/** One row of the rings table, as typed (km and € are strings). */
export interface RingRow {
  key: string
  km: string
  fee: string
  label: string
}

export interface EditorCutLine extends CutLineInput {
  id: string
}

export interface EditorRule extends RuleInput {
  id: string
}

export interface EditorState {
  origin: LatLng | null
  rings: RingRow[]
  cut_lines: EditorCutLine[]
  rules: EditorRule[]
}

export const EMPTY_STATE: EditorState = { origin: null, rings: [], cut_lines: [], rules: [] }

export function newId(): string {
  return globalThis.crypto.randomUUID()
}

export function stateFromView(view: ZoneSetView): EditorState {
  return {
    origin: view.origin,
    rings: view.rings.map((r) => ({ key: r.id, km: formatKm(r.radius_m), fee: feeInput(r.fee), label: r.label ?? "" })),
    cut_lines: view.cut_lines.map((c) => ({ id: c.id, label: c.label, points: c.points })),
    rules: view.rules.map((u) => ({ id: u.id, anchor: u.anchor, mode: u.mode, fee: u.fee, label: u.label })),
  }
}

export function stateFromPayload(p: DraftPayload): EditorState {
  return {
    origin: p.origin,
    rings: p.rings.map((r) => ({ key: newId(), km: formatKm(r.radius_m), fee: feeInput(r.fee), label: r.label ?? "" })),
    cut_lines: p.cut_lines.map((c) => ({ ...c, id: c.id ?? newId() })),
    rules: p.rules.map((u) => ({ ...u, id: u.id ?? newId() })),
  }
}

export type RingFieldErrors = Record<string, { km?: string; fee?: string }>

/** Per-row problems: invalid km, invalid or blank fee, duplicate distance. */
export function ringErrors(rings: RingRow[]): RingFieldErrors {
  const errors: RingFieldErrors = {}
  const count = new Map<number, number>()
  for (const r of rings) {
    const m = parseKm(r.km)
    if (m !== null) count.set(m, (count.get(m) ?? 0) + 1)
  }
  for (const r of rings) {
    const e: { km?: string; fee?: string } = {}
    const m = parseKm(r.km)
    if (m === null) e.km = "0.1–50 km, one decimal"
    else if ((count.get(m) ?? 0) > 1) e.km = "Duplicate distance"
    if (parseEuro(r.fee) === null) e.fee = r.fee.trim() === "" ? "Required" : "0–999.99, two decimals"
    if (e.km || e.fee) errors[r.key] = e
  }
  return errors
}

/** Rows sorted by distance; rows with an invalid distance keep their place at the end. */
export function sortRings(rings: RingRow[]): RingRow[] {
  return rings
    .map((r, i) => ({ r, i, m: parseKm(r.km) }))
    .sort((a, b) => (a.m ?? Infinity) - (b.m ?? Infinity) || a.i - b.i)
    .map((x) => x.r)
}

export type BuildResult = { ok: true; payload: DraftPayload } | { ok: false; reason: string }

/** The save payload, or why the current state can't be saved yet. */
export function buildPayload(state: EditorState): BuildResult {
  if (!state.origin) return { ok: false, reason: "Set the center point first." }
  if (Object.keys(ringErrors(state.rings)).length) return { ok: false, reason: "Fix the highlighted ring fields to save." }
  const payload: DraftPayload = {
    origin: state.origin,
    rings: sortRings(state.rings).map((r) => ({
      radius_m: parseKm(r.km) as number,
      fee: parseEuro(r.fee) as number,
      label: r.label.trim() || null,
    })),
    cut_lines: state.cut_lines.map((c) => ({ id: c.id, label: c.label?.trim() || null, points: c.points })),
    rules: state.rules.map((u) => ({
      id: u.id,
      anchor: u.anchor,
      mode: u.mode,
      fee: u.mode === "custom_fee" ? u.fee : null,
      label: u.label?.trim() || null,
    })),
  }
  const check = parseDraftPayload(payload)
  return check.ok ? { ok: true, payload: check.payload } : { ok: false, reason: `Invalid field: ${check.field}` }
}

// ---- Export / import (the fallback when the drawing UI can't be used) ----

export const EXPORT_FORMAT = "birraora-delivery-zones"

export function exportJson(payload: DraftPayload, meta: { slug: string; exported_at: string }): string {
  return JSON.stringify({ format: EXPORT_FORMAT, format_version: 1, ...meta, ...payload }, null, 2)
}

export type ImportResult = { ok: true; payload: DraftPayload } | { ok: false; error: string }

/**
 * Parse an imported file: an export from this editor, or a bare payload
 * ({ origin, rings, cut_lines, rules }). It is then saved through the same
 * route, so the database validates it again.
 */
export function parseImportJson(text: string): ImportResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: "The file is not valid JSON." }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "Expected a JSON object." }
  const d = data as Record<string, unknown>
  if (d.format !== undefined && d.format !== EXPORT_FORMAT) return { ok: false, error: `Unknown format "${String(d.format)}".` }
  const check = parseDraftPayload({ origin: d.origin, rings: d.rings, cut_lines: d.cut_lines ?? [], rules: d.rules ?? [] })
  if (!check.ok) return { ok: false, error: `Invalid field: ${check.field}` }
  return { ok: true, payload: check.payload }
}
