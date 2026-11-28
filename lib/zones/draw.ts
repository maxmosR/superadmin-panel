// The Cut step's drawing rules (pure, unit-tested). A cut is drawn segment by
// segment; each click ends one segment and starts the next:
//   * clicking the first point again (3+ points) closes a shape ("polygon");
//   * clicking a ring's circle puts the point exactly on it; from the second
//     point on, that ends the line ("path"): the line and the ring edge close
//     the area between them;
//   * clicking the last point again (a double-click) ends an open line anywhere.
// Pieces are still computed only in SQL; this only decides what was drawn.
import { destination, distanceM } from "./geo"
import type { LatLng } from "./types"

/** How close (in screen pixels) a click must be to snap. */
export const SNAP_PX = 12

/** Ground metres per screen pixel at a latitude and Google Maps zoom. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156_543.033_92 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}

/** Initial bearing from a to b in degrees (0 = north, clockwise). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

/** `p` moved onto the nearest ring circle within `tolM`, or null. */
export function snapToRing(p: LatLng, origin: LatLng | null, radiiM: number[], tolM: number): LatLng | null {
  if (!origin) return null
  const d = distanceM(origin, p)
  let best: number | null = null
  for (const r of radiiM) {
    if (Math.abs(d - r) <= tolM && (best === null || Math.abs(d - r) < Math.abs(d - best))) best = r
  }
  return best === null ? null : destination(origin, best, bearingDeg(origin, p))
}

export interface DrawContext {
  /** Points placed so far. */
  points: LatLng[]
  origin: LatLng | null
  radiiM: number[]
  /** Snap distance in metres (SNAP_PX at the current zoom). */
  tolM: number
}

export type DrawStep =
  | { action: "add"; point: LatLng; onRing: boolean }
  | { action: "finish"; kind: "polygon" | "path"; points: LatLng[] }
  | { action: "ignore" }

/** What a click at `p` does to the cut being drawn. */
export function drawClick(p: LatLng, ctx: DrawContext): DrawStep {
  const { points, tolM } = ctx
  const n = points.length
  if (n >= 3 && distanceM(p, points[0]) <= tolM) return { action: "finish", kind: "polygon", points }
  if (n >= 1 && distanceM(p, points[n - 1]) <= tolM) {
    return n >= 2 ? { action: "finish", kind: "path", points } : { action: "ignore" }
  }
  const onRing = snapToRing(p, ctx.origin, ctx.radiiM, tolM)
  const point = onRing ?? p
  if (onRing && n >= 1) return { action: "finish", kind: "path", points: [...points, point] }
  return { action: "add", point, onRing: !!onRing }
}

/** Where the next point would go (for the preview while the pointer moves). */
export function drawPreview(p: LatLng, ctx: DrawContext): { point: LatLng; closes: boolean } {
  const { points, tolM } = ctx
  if (points.length >= 3 && distanceM(p, points[0]) <= tolM) return { point: points[0], closes: true }
  const onRing = snapToRing(p, ctx.origin, ctx.radiiM, tolM)
  return { point: onRing ?? p, closes: !!onRing && points.length >= 1 }
}

/** An edited open line keeps its ends on a ring circle when they were dragged near one. */
export function snapPathEnds(points: LatLng[], origin: LatLng | null, radiiM: number[], tolM: number): LatLng[] {
  if (points.length < 2) return points
  const out = [...points]
  const first = snapToRing(out[0], origin, radiiM, tolM)
  const last = snapToRing(out[out.length - 1], origin, radiiM, tolM)
  if (first) out[0] = first
  if (last) out[out.length - 1] = last
  return out
}
