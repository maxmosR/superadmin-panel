// Parsing and formatting of the editor's km and € fields.

/**
 * A distance typed in km ("1,5" or "1.5"), at most one decimal, 0.1–50 km.
 * Returns metres, or null when invalid (blank included).
 */
export function parseKm(text: string): number | null {
  const t = text.trim().replace(",", ".")
  if (!/^\d{1,2}(\.\d)?$/.test(t)) return null
  const m = Math.round(Number(t) * 10) * 100
  return m >= 100 && m <= 50_000 ? m : null
}

/**
 * A fee typed in euros ("3,50", "3.50", "3"), at most two decimals,
 * 0–999.99. Blank is invalid: it must never be saved as €0.
 */
export function parseEuro(text: string): number | null {
  const t = text.trim().replace(/^€\s*/, "").replace(",", ".")
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100) / 100
}

/**
 * A ring's minimum order typed in euros ("15", "12,50"), at most two
 * decimals, up to 9999.99. Blank means no minimum (0). Null when invalid.
 */
export function parseMinOrder(text: string): number | null {
  const t = text.trim().replace(/^€\s*/, "").replace(",", ".")
  if (t === "") return 0
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null
  return Math.round(Number(t) * 100) / 100
}

/** 15 -> "15.00", 0 -> "" (blank = no minimum) */
export function minOrderInput(v: number): string {
  return v > 0 ? v.toFixed(2) : ""
}

/** 1500 -> "1.5" */
export function formatKm(m: number): string {
  return (Math.round(m / 100) / 10).toFixed(1)
}

/** 3.5 -> "3.50" (for an input field) */
export function feeInput(fee: number): string {
  return fee.toFixed(2)
}

/** 3.5 -> "€3.50" */
export function formatEuro(fee: number | null | undefined): string {
  return fee === null || fee === undefined ? "—" : `€${fee.toFixed(2)}`
}

/** Snap a distance in metres to 0.1 km, within 0.1–50 km. */
export function snapRadius(m: number): number {
  return Math.min(50_000, Math.max(100, Math.round(m / 100) * 100))
}

/** Square metres -> "0.42 km²" or "830 m²". */
export function formatArea(m2: number): string {
  return m2 >= 100_000 ? `${(m2 / 1_000_000).toFixed(2)} km²` : `${Math.round(m2)} m²`
}

/** Metres -> "850 m" / "2.4 km" */
export function formatDistance(m: number | null | undefined): string {
  if (m === null || m === undefined) return "—"
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}
