"use client"

// The zone editor's map. It only DISPLAYS server results (pieces, extended
// cut lines) plus drawing previews (ring circles, the lines being drawn). It
// never computes zones, fees or quotes.
//
// - Terra Draw (Google Maps adapter) draws and edits the center point and the
//   cut lines.
// - Ring circles are google.maps.Circle with a draggable edge handle each.
// - Pieces come from the server as GeoJSON on a Data layer.

import { useEffect, useRef, useState } from "react"
import {
  TerraDraw,
  TerraDrawLineStringMode,
  TerraDrawPointMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from "terra-draw"
import { TerraDrawGoogleMapsAdapter } from "terra-draw-google-maps-adapter"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { loadGoogleMaps, mapId, onMapsAuthFailure, MAPS_DOMAIN_ERROR } from "@/lib/google-maps/loader"
import { destination, distanceM } from "@/lib/zones/geo"
import { formatEuro, snapRadius } from "@/lib/zones/units"
import type { EditorCutLine, EditorRule } from "@/lib/zones/editor-state"
import type { ExtendedLine, IssueRef, LatLng, PieceCollection, PieceFeature } from "@/lib/zones/types"

export type EditorStep = "center" | "rings" | "cut" | "pieces" | "test" | "publish" | "history"
export type MapLayers = "draft" | "live" | "both"

/** Terra Draw ids must be UUID v4; the center point uses this fixed one. */
const ORIGIN_ID = "00000000-0000-4000-8000-000000000001"

export const RING_COLORS = ["#16a34a", "#2563eb", "#9333ea", "#ea580c", "#0891b2", "#ca8a04", "#db2777", "#4f46e5", "#65a30d", "#0d9488"]
export const ringColor = (ringIndex: number) => RING_COLORS[(ringIndex - 1) % RING_COLORS.length]

export interface ZoneMapProps {
  origin: LatLng | null
  rings: Array<{ key: string; radiusM: number }>
  cutLines: EditorCutLine[]
  extendedLines: ExtendedLine[]
  pieces: PieceCollection | null
  livePieces: PieceCollection | null
  layers: MapLayers
  rules: EditorRule[]
  step: EditorStep
  readOnly: boolean
  drawing: boolean
  selectedLineId: string | null
  highlightPieceId: string | null
  testPoint: LatLng | null
  focus: (IssueRef & { nonce: number }) | null
  /** Bump to force the drawn features back to the props (e.g. after a cancelled move). */
  resyncNonce: number
  onOriginChange: (p: LatLng) => void
  onRingRadiusChange: (key: string, radiusM: number) => void
  onLinesChange: (lines: Array<{ id: string; points: LatLng[] }>) => void
  onDrawFinished: () => void
  onSelectLine: (id: string | null) => void
  onPieceClick: (pieceId: string, at: LatLng, pixel: { x: number; y: number }) => void
  onPieceHover: (pieceId: string | null) => void
  onMapClick: (at: LatLng) => void
  onRuleMove: (id: string, at: LatLng) => void
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-8

function samePoints(a: LatLng[], b: LatLng[]) {
  return a.length === b.length && a.every((p, i) => near(p.lat, b[i].lat) && near(p.lng, b[i].lng))
}

function labelEl(text: string, tone: "fee" | "none") {
  const el = document.createElement("div")
  el.textContent = text
  el.className =
    tone === "fee"
      ? "rounded bg-white/95 px-1.5 py-0.5 text-xs font-semibold text-gray-900 shadow"
      : "rounded bg-gray-700/90 px-1.5 py-0.5 text-[11px] font-medium text-white shadow"
  return el
}

function dotEl(color: string, size = 12) {
  const el = document.createElement("div")
  el.style.width = `${size}px`
  el.style.height = `${size}px`
  el.style.borderRadius = "9999px"
  el.style.background = color
  el.style.border = "2px solid white"
  el.style.boxShadow = "0 0 0 1px rgba(0,0,0,.35)"
  el.style.transform = "translateY(50%)"
  return el
}

function pinEl(color: string) {
  const el = document.createElement("div")
  el.style.width = "14px"
  el.style.height = "14px"
  el.style.borderRadius = "50% 50% 50% 0"
  el.style.transform = "rotate(-45deg)"
  el.style.background = color
  el.style.border = "2px solid white"
  el.style.boxShadow = "0 0 0 1px rgba(0,0,0,.4)"
  return el
}

/** Show or hide an overlay (a helper, so React's lint doesn't flag ref mutations). */
function setOverlayMap(o: google.maps.Polyline | google.maps.marker.AdvancedMarkerElement, map: google.maps.Map | null) {
  if (o instanceof google.maps.Polyline) o.setMap(map)
  else o.map = map
}

function polygonBounds(f: PieceFeature): google.maps.LatLngBounds {
  const b = new google.maps.LatLngBounds()
  for (const [lng, lat] of f.geometry.coordinates[0] ?? []) b.extend({ lat, lng })
  return b
}

export function ZoneMap(props: ZoneMapProps) {
  const divRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<google.maps.Map | null>(null)
  const drawRef = useRef<TerraDraw | null>(null)
  const draftDataRef = useRef<google.maps.Data | null>(null)
  const liveDataRef = useRef<google.maps.Data | null>(null)
  const viewOverlays = useRef<Array<google.maps.Polyline | google.maps.marker.AdvancedMarkerElement>>([])
  const extOverlays = useRef<google.maps.Polyline[]>([])
  const ringObjs = useRef(new Map<string, { circle: google.maps.Circle; handle: google.maps.marker.AdvancedMarkerElement; dragging: boolean }>())
  const ruleMarkers = useRef(new Map<string, google.maps.marker.AdvancedMarkerElement>())
  const testMarker = useRef<google.maps.marker.AdvancedMarkerElement | null>(null)
  const centeredOnce = useRef(false)
  const [ready, setReady] = useState(false)
  const [drawReady, setDrawReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Latest props for event handlers registered once.
  const live = useRef(props)
  useEffect(() => {
    live.current = props
  })

  // ---- init ----------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    const off = onMapsAuthFailure(() => setError(MAPS_DOMAIN_ERROR))
    loadGoogleMaps()
      .then(async (g) => {
        await Promise.all([g.maps.importLibrary("maps"), g.maps.importLibrary("marker")])
        if (cancelled || !divRef.current) return
        const start = live.current.origin
        const map = new google.maps.Map(divRef.current, {
          center: start ?? { lat: 41.9, lng: 12.5 },
          zoom: start ? 13 : 6,
          mapId: mapId(),
          clickableIcons: false,
          gestureHandling: "greedy",
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
        })
        mapRef.current = map
        centeredOnce.current = !!start

        const draftData = new google.maps.Data({ map })
        const liveData = new google.maps.Data({ map })
        draftDataRef.current = draftData
        liveDataRef.current = liveData
        liveData.setStyle({ fillOpacity: 0, strokeColor: "#f97316", strokeWeight: 2, clickable: false, zIndex: 3 })

        const pixelOf = (e: google.maps.Data.MouseEvent | google.maps.MapMouseEvent) => {
          const rect = divRef.current?.getBoundingClientRect()
          const dom = e.domEvent as MouseEvent | undefined
          return rect && dom && "clientX" in dom ? { x: dom.clientX - rect.left, y: dom.clientY - rect.top } : { x: 0, y: 0 }
        }
        draftData.addListener("click", (e: google.maps.Data.MouseEvent) => {
          const p = live.current
          if (!e.latLng) return
          const at = { lat: e.latLng.lat(), lng: e.latLng.lng() }
          if (p.step === "test") return p.onMapClick(at)
          if (p.step === "pieces" && !p.readOnly) p.onPieceClick(String(e.feature.getId()), at, pixelOf(e))
        })
        draftData.addListener("mouseover", (e: google.maps.Data.MouseEvent) => live.current.onPieceHover(String(e.feature.getId())))
        draftData.addListener("mouseout", () => live.current.onPieceHover(null))
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return
          if (live.current.step === "test") live.current.onMapClick({ lat: e.latLng.lat(), lng: e.latLng.lng() })
        })

        const draw = new TerraDraw({
          adapter: new TerraDrawGoogleMapsAdapter({ lib: google.maps, map, coordinatePrecision: 9, isolatedData: true }),
          modes: [
            new TerraDrawPointMode({ styles: { pointColor: "#dc2626", pointWidth: 8, pointOutlineColor: "#ffffff", pointOutlineWidth: 2 } }),
            new TerraDrawLineStringMode({ styles: { lineStringColor: "#111827", lineStringWidth: 3 } }),
            new TerraDrawSelectMode({
              modeName: "select-center",
              flags: { point: { feature: { draggable: true } } },
              styles: { selectedPointColor: "#dc2626", selectedPointWidth: 9 },
            }),
            new TerraDrawSelectMode({
              modeName: "select-lines",
              flags: {
                linestring: { feature: { draggable: false, coordinates: { draggable: true, midpoints: true, deletable: true } } },
              },
              styles: { selectedLineStringColor: "#2563eb", selectedLineStringWidth: 4 },
            }),
          ],
        })

        const emit = () => {
          const snap = draw.getSnapshot()
          const lines = snap
            .filter((f) => f.geometry.type === "LineString" && f.properties.mode === "linestring")
            .map((f) => ({
              id: String(f.id),
              points: (f.geometry.coordinates as number[][]).map(([lng, lat]) => ({ lat, lng })),
            }))
          live.current.onLinesChange(lines)
          const o = snap.find((f) => f.id === ORIGIN_ID)
          if (o && o.geometry.type === "Point") {
            const [lng, lat] = o.geometry.coordinates as number[]
            const cur = live.current.origin
            if (!cur || !near(cur.lat, lat) || !near(cur.lng, lng)) live.current.onOriginChange({ lat, lng })
          }
        }

        draw.on("ready", () => !cancelled && setDrawReady(true))
        draw.on("finish", (id, ctx) => {
          if (ctx.mode === "point" && ctx.action === "draw") {
            // The first click places the center: give it the fixed id.
            const f = draw.getSnapshot().find((x) => x.id === id)
            draw.removeFeatures([id])
            if (f && f.geometry.type === "Point") {
              const [lng, lat] = f.geometry.coordinates as number[]
              live.current.onOriginChange({ lat, lng })
            }
            return
          }
          emit()
          if (ctx.mode === "linestring" && ctx.action === "draw") live.current.onDrawFinished()
        })
        draw.on("change", (_ids, type, context) => {
          if (type === "delete" && !(context && "origin" in context && context.origin === "api")) emit()
        })
        draw.on("select", (id) => {
          if (id !== ORIGIN_ID) live.current.onSelectLine(String(id))
        })
        draw.on("deselect", () => live.current.onSelectLine(null))
        draw.start()
        drawRef.current = draw
        setReady(true)
      })
      .catch((e: Error) => !cancelled && setError(e.message || MAPS_DOMAIN_ERROR))
    return () => {
      cancelled = true
      off()
      try {
        drawRef.current?.stop()
      } catch {
        // already stopped
      }
      drawRef.current = null
    }
  }, [])

  // ---- center the map on the origin the first time we have one --------------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !props.origin || centeredOnce.current) return
    map.setCenter(props.origin)
    map.setZoom(13)
    centeredOnce.current = true
  }, [ready, props.origin])

  // ---- Terra Draw: mode -------------------------------------------------------
  useEffect(() => {
    const draw = drawRef.current
    if (!drawReady || !draw) return
    let mode = "static"
    if (!props.readOnly) {
      if (props.step === "center") mode = props.origin ? "select-center" : "point"
      else if (props.step === "cut") mode = props.drawing ? "linestring" : "select-lines"
    }
    if (draw.getMode() !== mode) draw.setMode(mode)
  }, [drawReady, props.step, props.drawing, props.readOnly, props.origin])

  // ---- Terra Draw: features follow the props ---------------------------------
  useEffect(() => {
    const draw = drawRef.current
    if (!drawReady || !draw) return
    const snap = draw.getSnapshot()
    const byId = new Map(snap.map((f) => [String(f.id), f]))
    const remove: string[] = []
    const add: GeoJSONStoreFeatures[] = []

    const o = byId.get(ORIGIN_ID)
    if (props.origin) {
      const same = o && o.geometry.type === "Point" && samePoints([{ lng: (o.geometry.coordinates as number[])[0], lat: (o.geometry.coordinates as number[])[1] }], [props.origin])
      if (!same) {
        if (o) remove.push(ORIGIN_ID)
        add.push({ id: ORIGIN_ID, type: "Feature", geometry: { type: "Point", coordinates: [props.origin.lng, props.origin.lat] }, properties: { mode: "point" } })
      }
    } else if (o) remove.push(ORIGIN_ID)

    const wanted = new Set(props.cutLines.map((c) => c.id))
    for (const f of snap) {
      if (f.properties.mode === "linestring" && !wanted.has(String(f.id))) remove.push(String(f.id))
    }
    for (const c of props.cutLines) {
      const f = byId.get(c.id)
      const pts = f && f.geometry.type === "LineString" ? (f.geometry.coordinates as number[][]).map(([lng, lat]) => ({ lat, lng })) : null
      if (pts && samePoints(pts, c.points)) continue
      if (f) remove.push(c.id)
      add.push({
        id: c.id,
        type: "Feature",
        geometry: { type: "LineString", coordinates: c.points.map((p) => [p.lng, p.lat]) },
        properties: { mode: "linestring" },
      })
    }
    if (remove.length) draw.removeFeatures(remove)
    if (add.length) draw.addFeatures(add)
  }, [drawReady, props.origin, props.cutLines, props.resyncNonce])

  // ---- Terra Draw: selected line from the side list ---------------------------
  useEffect(() => {
    const draw = drawRef.current
    if (!drawReady || !draw || props.step !== "cut" || props.drawing || !props.selectedLineId) return
    try {
      if (draw.getSnapshot().some((f) => f.id === props.selectedLineId)) draw.selectFeature(props.selectedLineId, "select-lines")
    } catch {
      // Not selectable in the current mode.
    }
  }, [drawReady, props.selectedLineId, props.step, props.drawing])

  // ---- rings: circles + edge handles (updated in place while dragging) -------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const objs = ringObjs.current
    const keys = new Set(props.origin ? props.rings.map((r) => r.key) : [])
    for (const [k, o] of objs) {
      if (!keys.has(k)) {
        o.circle.setMap(null)
        o.handle.map = null
        objs.delete(k)
      }
    }
    if (!props.origin) return
    const origin = props.origin
    const editable = !props.readOnly && props.step === "rings"
    const sorted = [...props.rings].sort((a, b) => a.radiusM - b.radiusM)
    sorted.forEach((r, i) => {
      let o = objs.get(r.key)
      const color = ringColor(i + 1)
      if (!o) {
        const circle = new google.maps.Circle({ map, clickable: false, fillOpacity: 0, strokeWeight: 2, zIndex: 1 })
        const handle = new google.maps.marker.AdvancedMarkerElement({ map, content: dotEl(color, 14), title: "Drag to change the distance" })
        const entry = { circle, handle, dragging: false }
        handle.addListener("dragstart", () => (entry.dragging = true))
        handle.addListener("drag", () => {
          const pos = handle.position as google.maps.LatLngLiteral | google.maps.LatLng | null
          const cur = live.current.origin
          if (!pos || !cur) return
          const p = "lat" in pos && typeof pos.lat === "function" ? { lat: (pos as google.maps.LatLng).lat(), lng: (pos as google.maps.LatLng).lng() } : (pos as LatLng)
          const m = snapRadius(distanceM(cur, p))
          circle.setRadius(m)
          live.current.onRingRadiusChange(r.key, m)
        })
        handle.addListener("dragend", () => {
          entry.dragging = false
          const cur = live.current.origin
          if (cur) handle.position = destination(cur, circle.getRadius(), 90)
        })
        o = entry
        objs.set(r.key, o)
      }
      o.circle.setOptions({ center: origin, radius: r.radiusM, strokeColor: color, strokeOpacity: 0.9 })
      o.handle.gmpDraggable = editable
      o.handle.map = editable ? map : null
      if (!o.dragging) o.handle.position = destination(origin, r.radiusM, 90)
    })
  }, [ready, props.origin, props.rings, props.step, props.readOnly])

  // ---- pieces (server GeoJSON) ------------------------------------------------
  useEffect(() => {
    const data = draftDataRef.current
    const map = mapRef.current
    if (!ready || !data || !map) return
    data.forEach((f) => data.remove(f))
    for (const o of viewOverlays.current) setOverlayMap(o, null)
    viewOverlays.current = []
    if (!props.pieces) return
    data.addGeoJson(props.pieces, { idPropertyName: "id" })
    for (const f of props.pieces.features) {
      const p = f.properties
      const [lng, lat] = p.label_point
      if (!p.deliverable) {
        // Excluded: dashed outline and a "no delivery" label.
        for (const ring of f.geometry.coordinates) {
          viewOverlays.current.push(
            new google.maps.Polyline({
              map,
              path: ring.map(([x, y]) => ({ lat: y, lng: x })),
              strokeOpacity: 0,
              clickable: false,
              zIndex: 2,
              icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: "#374151", scale: 2 }, offset: "0", repeat: "10px" }],
            }),
          )
        }
        viewOverlays.current.push(new google.maps.marker.AdvancedMarkerElement({ map, position: { lat, lng }, content: labelEl("no delivery", "none") }))
      } else if (p.rule_id) {
        viewOverlays.current.push(
          new google.maps.marker.AdvancedMarkerElement({ map, position: { lat, lng }, content: labelEl(formatEuro(p.fee), "fee") }),
        )
      }
    }
  }, [ready, props.pieces])

  // Piece styling (depends on the step, highlight and layer choice).
  useEffect(() => {
    const data = draftDataRef.current
    if (!ready || !data) return
    const visible = props.layers !== "live"
    const clickable = !props.readOnly && (props.step === "pieces" || props.step === "test")
    data.setStyle((feature) => {
      const deliverable = feature.getProperty("deliverable") as boolean
      const ringIndex = feature.getProperty("ring_index") as number
      const custom = !!feature.getProperty("rule_id") && deliverable
      const hi = String(feature.getId()) === props.highlightPieceId
      return {
        visible,
        clickable,
        zIndex: 2,
        fillColor: deliverable ? ringColor(ringIndex) : "#9ca3af",
        fillOpacity: hi ? 0.6 : deliverable ? (custom ? 0.42 : 0.22) : 0.45,
        strokeColor: deliverable ? ringColor(ringIndex) : "#6b7280",
        strokeOpacity: deliverable ? 0.8 : 0,
        strokeWeight: hi ? 3 : 1,
      }
    })
    for (const o of viewOverlays.current) setOverlayMap(o, visible ? mapRef.current : null)
  }, [ready, props.pieces, props.layers, props.highlightPieceId, props.step, props.readOnly])

  // ---- live pieces (publish review) -------------------------------------------
  useEffect(() => {
    const data = liveDataRef.current
    if (!ready || !data) return
    data.forEach((f) => data.remove(f))
    if (props.livePieces && props.layers !== "draft") data.addGeoJson(props.livePieces, { idPropertyName: "id" })
  }, [ready, props.livePieces, props.layers])

  // ---- auto-extended part of the cut lines (server geometry, dashed) ----------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    for (const l of extOverlays.current) l.setMap(null)
    extOverlays.current = []
    if (props.layers === "live") return
    for (const e of props.extendedLines) {
      const g = e.geometry as { type: string; coordinates: unknown }
      const parts: number[][][] =
        g.type === "LineString" ? [g.coordinates as number[][]] : g.type === "MultiLineString" ? (g.coordinates as number[][][]) : []
      for (const part of parts) {
        extOverlays.current.push(
          new google.maps.Polyline({
            map,
            path: part.map(([lng, lat]) => ({ lat, lng })),
            strokeOpacity: 0,
            clickable: false,
            zIndex: 1,
            icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: "#111827", scale: 2 }, offset: "0", repeat: "12px" }],
          }),
        )
      }
    }
  }, [ready, props.extendedLines, props.layers])

  // ---- rule anchors (draggable in the Pieces step) ----------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const markers = ruleMarkers.current
    const ids = new Set(props.rules.map((u) => u.id))
    for (const [id, m] of markers) {
      if (!ids.has(id)) {
        m.map = null
        markers.delete(id)
      }
    }
    const editable = !props.readOnly && props.step === "pieces"
    for (const u of props.rules) {
      let m = markers.get(u.id)
      const color = u.mode === "excluded" ? "#374151" : u.mode === "custom_fee" ? "#2563eb" : "#16a34a"
      if (!m) {
        m = new google.maps.marker.AdvancedMarkerElement({ map, content: pinEl(color), title: u.label ?? "Piece setting" })
        const id = u.id
        const marker = m
        m.addListener("dragend", () => {
          const pos = marker.position as google.maps.LatLngLiteral | google.maps.LatLng | null
          if (!pos) return
          const p = typeof (pos as google.maps.LatLng).lat === "function"
            ? { lat: (pos as google.maps.LatLng).lat(), lng: (pos as google.maps.LatLng).lng() }
            : (pos as LatLng)
          live.current.onRuleMove(id, p)
        })
        markers.set(u.id, m)
      } else {
        m.content = pinEl(color)
      }
      m.position = u.anchor
      m.gmpDraggable = editable
      m.map = props.layers === "live" ? null : map
    }
  }, [ready, props.rules, props.step, props.readOnly, props.layers])

  // ---- test pin -----------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (!props.testPoint) {
      if (testMarker.current) testMarker.current.map = null
      return
    }
    if (!testMarker.current) {
      const pin = new google.maps.marker.PinElement({ background: "#111827", borderColor: "#ffffff", glyphColor: "#ffffff" })
      testMarker.current = new google.maps.marker.AdvancedMarkerElement({ content: pin.element, title: "Tested point", zIndex: 10 })
    }
    testMarker.current.position = props.testPoint
    testMarker.current.map = map
  }, [ready, props.testPoint])

  // ---- "show on map" ----------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    const f = props.focus
    if (!ready || !map || !f) return
    const p = live.current
    if (f.kind === "piece") {
      const piece = p.pieces?.features.find((x) => x.id === f.id)
      if (piece) map.fitBounds(polygonBounds(piece), 60)
    } else if (f.kind === "line") {
      const line = p.cutLines.find((c) => c.id === f.id)
      if (line) {
        const b = new google.maps.LatLngBounds()
        line.points.forEach((pt) => b.extend(pt))
        map.fitBounds(b, 60)
      }
    } else if (f.kind === "rule") {
      const rule = p.rules.find((u) => u.id === f.id)
      if (rule) {
        map.panTo(rule.anchor)
        map.setZoom(Math.max(map.getZoom() ?? 13, 14))
      }
    } else if (f.kind === "ring" && p.origin) {
      const radius = ringObjs.current.get(f.id)?.circle.getRadius()
      const ring = p.rings.find((r) => r.key === f.id)
      const m = radius ?? ring?.radiusM
      if (m) {
        const b = new google.maps.LatLngBounds()
        b.extend(destination(p.origin, m, 0))
        b.extend(destination(p.origin, m, 180))
        b.extend(destination(p.origin, m, 90))
        b.extend(destination(p.origin, m, 270))
        map.fitBounds(b, 40)
      }
    }
  }, [ready, props.focus])

  return (
    <div className="relative h-full min-h-[420px] w-full overflow-hidden rounded-md border bg-muted">
      <div ref={divRef} className="absolute inset-0" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/95 p-6">
          <Alert variant="destructive" className="max-w-md">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Loading map…</div>
      )}
    </div>
  )
}
