// Small spherical helpers for drawing previews only (circle edge handles,
// "moved N m" hints). Zones, fees and quotes are always computed in SQL.
import type { LatLng } from "./types"

const R = 6_371_008.8
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Great-circle distance in metres. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** The point `d` metres from `from` at bearing `bearingDeg` (0 = north). */
export function destination(from: LatLng, d: number, bearingDeg: number): LatLng {
  const δ = d / R
  const θ = rad(bearingDeg)
  const φ1 = rad(from.lat)
  const λ1 = rad(from.lng)
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ))
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2))
  return { lat: deg(φ2), lng: ((deg(λ2) + 540) % 360) - 180 }
}

/** "44.40560, 8.94630" or "44.4056 8.9463" -> LatLng (lat first). */
export function parseLatLngText(text: string): LatLng | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

export function formatLatLng(p: LatLng): string {
  return `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`
}
