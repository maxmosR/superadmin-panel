import { describe, expect, it } from "vitest"
import { bearingDeg, drawClick, drawPreview, metersPerPixel, snapPathEnds, snapToRing, type DrawContext } from "@/lib/zones/draw"
import { destination, distanceM, inPolygon } from "@/lib/zones/geo"
import type { LatLng } from "@/lib/zones/types"

const O: LatLng = { lat: 44.4056, lng: 8.9463 }
const at = (d: number, az: number) => destination(O, d, az)
const ctx = (points: LatLng[]): DrawContext => ({ points, origin: O, radiiM: [1500, 2500], tolM: 20 })

describe("cut drawing rules", () => {
  it("adds a point per click away from circles", () => {
    expect(drawClick(at(1000, 0), ctx([]))).toEqual({ action: "add", point: at(1000, 0), onRing: false })
    expect(drawClick(at(1000, 90), ctx([at(1000, 0)]))).toMatchObject({ action: "add", onRing: false })
  })

  it("snaps a first point onto a circle without finishing", () => {
    const step = drawClick(at(1510, 30), ctx([]))
    expect(step.action).toBe("add")
    if (step.action !== "add") return
    expect(step.onRing).toBe(true)
    expect(distanceM(O, step.point)).toBeCloseTo(1500, 3)
  })

  it("ends a line on a circle, the point exactly on it", () => {
    const step = drawClick(at(2490, 120), ctx([at(1500, 60), at(2000, 90)]))
    expect(step.action).toBe("finish")
    if (step.action !== "finish") return
    expect(step.kind).toBe("path")
    expect(step.points).toHaveLength(3)
    expect(distanceM(O, step.points[2])).toBeCloseTo(2500, 3)
  })

  it("closes a shape on its first point (3+ points), not before", () => {
    const pts = [at(1000, 0), at(1000, 60), at(1000, 120)]
    expect(drawClick(at(1005, 0), ctx(pts))).toEqual({ action: "finish", kind: "polygon", points: pts })
    // With 2 points, clicking the first one again just adds it.
    expect(drawClick(at(1005, 0), ctx(pts.slice(0, 2))).action).toBe("add")
  })

  it("clicking the last point again (double-click) ends an open line", () => {
    const pts = [at(1000, 0), at(1000, 60)]
    expect(drawClick(at(1003, 60), ctx(pts))).toEqual({ action: "finish", kind: "path", points: pts })
    expect(drawClick(at(1003, 0), ctx(pts.slice(0, 1)))).toEqual({ action: "ignore" })
  })

  it("previews the snap target", () => {
    expect(drawPreview(at(1000, 0.5), ctx([at(1000, 0), at(1000, 60), at(1000, 120)])).closes).toBe(true)
    const pv = drawPreview(at(1495, 200), ctx([at(1000, 0)]))
    expect(pv.closes).toBe(true)
    expect(distanceM(O, pv.point)).toBeCloseTo(1500, 3)
    expect(drawPreview(at(1000, 200), ctx([])).closes).toBe(false)
  })

  it("keeps an edited line's ends on the circles they were dragged near", () => {
    const out = snapPathEnds([at(1490, 10), at(1000, 50), at(2000, 90)], O, [1500, 2500], 20)
    expect(distanceM(O, out[0])).toBeCloseTo(1500, 3)
    expect(out[1]).toEqual(at(1000, 50))
    expect(out[2]).toEqual(at(2000, 90))
  })

  it("geometry helpers", () => {
    expect(bearingDeg(O, at(1000, 90))).toBeCloseTo(90, 1)
    expect(snapToRing(at(1000, 0), O, [1500], 20)).toBeNull()
    expect(snapToRing(at(1000, 0), null, [1000], 20)).toBeNull()
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03392, 3)
    expect(metersPerPixel(60, 1)).toBeCloseTo(156543.03392 / 4, 3)
  })
})

describe("inPolygon (which piece a pin is in, display only)", () => {
  const square = (x0: number, y0: number, s: number) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]]
  it("is inside the outer ring and outside its holes", () => {
    const donut = [square(8.9, 44.4, 0.1), square(8.94, 44.44, 0.02)]
    expect(inPolygon({ lat: 44.41, lng: 8.91 }, donut)).toBe(true)
    expect(inPolygon({ lat: 44.45, lng: 8.95 }, donut)).toBe(false)
    expect(inPolygon({ lat: 44.6, lng: 8.91 }, donut)).toBe(false)
    expect(inPolygon({ lat: 44.41, lng: 8.91 }, [])).toBe(false)
  })
})

describe("geodesics match the database (PostGIS geography, WGS84)", () => {
  // Reference values from ST_Project / ST_Distance on the same points.
  it("destination", () => {
    const w = destination(O, 8300, 270)
    expect(w.lat).toBeCloseTo(44.4055524758102, 8)
    expect(w.lng).toBeCloseTo(8.84210433057851, 8)
    const ne = destination(O, 10500, 30)
    expect(ne.lat).toBeCloseTo(44.4874130953785, 8)
    expect(ne.lng).toBeCloseTo(9.01229897612807, 8)
  })
  it("distance", () => {
    expect(distanceM(O, { lat: 44.45, lng: 8.85 })).toBeCloseTo(9118.24108971, 2)
    expect(distanceM(O, O)).toBe(0)
  })
  it("a point snapped onto a far circle is on the database's circle", () => {
    // Was ~23 m off at 8.3 km east-west with a spherical earth.
    const s = snapToRing(destination(O, 8310, 275), O, [8300], 20)
    expect(s).not.toBeNull()
    expect(distanceM(O, s!)).toBeCloseTo(8300, 3)
  })
})
