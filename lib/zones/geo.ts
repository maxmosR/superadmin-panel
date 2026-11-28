// Small geodesic helpers for drawing (circle edge handles, snapping a cut
// line's end onto a ring, "moved N m" hints). Zones, fees and quotes are
// always computed in SQL. Distances are on the WGS84 ellipsoid (Vincenty),
// like the database's geography: on a sphere an east-west distance at
// Genoa's latitude is ~0.28 % short (23 m at 8 km), and an end "snapped"
// onto a circle missed the ring the database builds.
import type { LatLng } from "./types"

const A = 6_378_137
const F = 1 / 298.257_223_563
const B = A * (1 - F)
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Geodesic distance in metres on WGS84 (Vincenty inverse). */
export function distanceM(a: LatLng, b: LatLng): number {
  const L = rad(b.lng - a.lng)
  const U1 = Math.atan((1 - F) * Math.tan(rad(a.lat)))
  const U2 = Math.atan((1 - F) * Math.tan(rad(b.lat)))
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2)
  let λ = L
  let sinσ = 0, cosσ = 1, σ = 0, cos2α = 1, cos2σm = 0
  for (let i = 0; i < 200; i++) {
    const sinλ = Math.sin(λ), cosλ = Math.cos(λ)
    sinσ = Math.sqrt((cosU2 * sinλ) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosλ) ** 2)
    if (sinσ === 0) return 0
    cosσ = sinU1 * sinU2 + cosU1 * cosU2 * cosλ
    σ = Math.atan2(sinσ, cosσ)
    const sinα = (cosU1 * cosU2 * sinλ) / sinσ
    cos2α = 1 - sinα * sinα
    cos2σm = cos2α === 0 ? 0 : cosσ - (2 * sinU1 * sinU2) / cos2α
    const C = (F / 16) * cos2α * (4 + F * (4 - 3 * cos2α))
    const prev = λ
    λ = L + (1 - C) * F * sinα * (σ + C * sinσ * (cos2σm + C * cosσ * (-1 + 2 * cos2σm * cos2σm)))
    if (Math.abs(λ - prev) < 1e-12) break
  }
  const u2 = (cos2α * (A * A - B * B)) / (B * B)
  const k1 = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
  const k2 = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))
  const Δσ = k2 * sinσ * (cos2σm + (k2 / 4) * (cosσ * (-1 + 2 * cos2σm * cos2σm) - (k2 / 6) * cos2σm * (-3 + 4 * sinσ * sinσ) * (-3 + 4 * cos2σm * cos2σm)))
  return B * k1 * (σ - Δσ)
}

/** The point `d` metres from `from` at azimuth `bearingDeg` (0 = north), on WGS84 (Vincenty direct). */
export function destination(from: LatLng, d: number, bearingDeg: number): LatLng {
  const α1 = rad(bearingDeg)
  const sinα1 = Math.sin(α1), cosα1 = Math.cos(α1)
  const tanU1 = (1 - F) * Math.tan(rad(from.lat))
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1), sinU1 = tanU1 * cosU1
  const σ1 = Math.atan2(tanU1, cosα1)
  const sinα = cosU1 * sinα1
  const cos2α = 1 - sinα * sinα
  const u2 = (cos2α * (A * A - B * B)) / (B * B)
  const k1 = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)))
  const k2 = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)))
  let σ = d / (B * k1)
  let sinσ = 0, cosσ = 1, cos2σm = 0
  for (let i = 0; i < 200; i++) {
    cos2σm = Math.cos(2 * σ1 + σ)
    sinσ = Math.sin(σ)
    cosσ = Math.cos(σ)
    const Δσ = k2 * sinσ * (cos2σm + (k2 / 4) * (cosσ * (-1 + 2 * cos2σm * cos2σm) - (k2 / 6) * cos2σm * (-3 + 4 * sinσ * sinσ) * (-3 + 4 * cos2σm * cos2σm)))
    const prev = σ
    σ = d / (B * k1) + Δσ
    if (Math.abs(σ - prev) < 1e-12) break
  }
  sinσ = Math.sin(σ)
  cosσ = Math.cos(σ)
  cos2σm = Math.cos(2 * σ1 + σ)
  const x = sinU1 * sinσ - cosU1 * cosσ * cosα1
  const φ2 = Math.atan2(sinU1 * cosσ + cosU1 * sinσ * cosα1, (1 - F) * Math.sqrt(sinα * sinα + x * x))
  const λ = Math.atan2(sinσ * sinα1, cosU1 * cosσ - sinU1 * sinσ * cosα1)
  const C = (F / 16) * cos2α * (4 + F * (4 - 3 * cos2α))
  const L = λ - (1 - C) * F * sinα * (σ + C * sinσ * (cos2σm + C * cosσ * (-1 + 2 * cos2σm * cos2σm)))
  return { lat: deg(φ2), lng: ((from.lng + deg(L) + 540) % 360) - 180 }
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

/**
 * True when `p` is inside a GeoJSON polygon ([lng, lat] rings, holes after
 * the first). For display only (which piece a pin sits in); the database
 * decides which piece a setting applies to.
 */
export function inPolygon(p: LatLng, rings: number[][][]): boolean {
  const inRing = (ring: number[][]) => {
    let inside = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]
      const [xj, yj] = ring[j]
      if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside
    }
    return inside
  }
  return rings.length > 0 && inRing(rings[0]) && !rings.slice(1).some(inRing)
}
