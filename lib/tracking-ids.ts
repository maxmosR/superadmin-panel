// A restaurant's own Google Analytics 4 measurement id and Meta Pixel id for
// its storefront (business_configurations.ga4_measurement_id / meta_pixel_id).
// Same formats as the backend CHECK constraints
// (../BirraOra-three-month-test/supabase/migrations/20261124120000_storefront_tracking_ids.sql)
// and the storefront's lib/tracking/ids.ts. Empty = not used (null).

export const GA4_ID_RE = /^G-[A-Z0-9]{4,16}$/
export const META_PIXEL_ID_RE = /^[0-9]{10,20}$/

export type Parsed = { ok: true; value: string | null } | { ok: false }

/** "g-abc123 " → "G-ABC123"; "" / null → null; anything else refused. */
export function parseGa4Id(raw: unknown): Parsed {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== "string") return { ok: false }
  const v = raw.replace(/\s+/g, "").toUpperCase()
  if (!v) return { ok: true, value: null }
  return GA4_ID_RE.test(v) ? { ok: true, value: v } : { ok: false }
}

/** Digits only; "" / null → null; anything else refused. */
export function parseMetaPixelId(raw: unknown): Parsed {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== "string") return { ok: false }
  const v = raw.replace(/\s+/g, "")
  if (!v) return { ok: true, value: null }
  return META_PIXEL_ID_RE.test(v) ? { ok: true, value: v } : { ok: false }
}
