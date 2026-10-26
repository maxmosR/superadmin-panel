"use client"

import { useState } from "react"
import { MapPin, Plus, Trash2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { newId, ringErrors, sortRings, type EditorState, type RingRow } from "@/lib/zones/editor-state"
import { distanceM, formatLatLng, parseLatLngText } from "@/lib/zones/geo"
import { feeInput, formatArea, formatDistance, formatEuro, parseEuro, parseKm } from "@/lib/zones/units"
import type { IssueRef, LatLng, PieceCollection, RuleMode, ZoneIssue } from "@/lib/zones/types"
import { ZONE_LIMITS } from "@/lib/zones/types"
import { PlacesSearch } from "./places-search"
import { ringColor } from "./zone-map"

type Edit = (fn: (s: EditorState) => EditorState) => void

// ---- 1. Center ---------------------------------------------------------------------

export function CenterStep({
  origin,
  liveOrigin,
  outerM,
  readOnly,
  onPick,
}: {
  origin: LatLng | null
  liveOrigin: LatLng | null
  outerM: number
  readOnly: boolean
  onPick: (p: LatLng) => void
}) {
  const [text, setText] = useState("")
  const typed = parseLatLngText(text)
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        The restaurant&apos;s location. Search its address, or click the map, then drag the red pin to adjust.
      </p>
      <PlacesSearch
        placeholder="Search the restaurant's address"
        disabled={readOnly}
        bias={origin ? { center: origin, radiusM: outerM + 2000 } : null}
        onPick={(p) => onPick(p.point)}
      />
      <div className="flex gap-2">
        <Input placeholder="or paste lat, lng" value={text} onChange={(e) => setText(e.target.value)} disabled={readOnly} />
        <Button variant="outline" disabled={readOnly || !typed} onClick={() => typed && onPick(typed)}>
          Set
        </Button>
      </div>
      <Separator />
      {origin ? (
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Coordinates</dt>
            <dd className="font-mono">{formatLatLng(origin)}</dd>
          </div>
          {liveOrigin && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">From the live center</dt>
              <dd>{formatDistance(distanceM(liveOrigin, origin))}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="text-sm text-amber-700">No center point yet: click the map to place it.</p>
      )}
      <p className="text-xs text-muted-foreground">
        The restaurant&apos;s stored coordinates change only when you publish.
      </p>
    </div>
  )
}

// ---- 2. Rings ----------------------------------------------------------------------

export function RingsStep({
  rings,
  readOnly,
  edit,
  onShow,
}: {
  rings: RingRow[]
  readOnly: boolean
  edit: Edit
  onShow: (ref: IssueRef) => void
}) {
  const errors = ringErrors(rings)
  const setRow = (key: string, patch: Partial<RingRow>) =>
    edit((s) => ({ ...s, rings: s.rings.map((r) => (r.key === key ? { ...r, ...patch } : r)) }))
  const sortedIndex = new Map(
    [...rings].filter((r) => parseKm(r.km) !== null).sort((a, b) => (parseKm(a.km) as number) - (parseKm(b.km) as number)).map((r, i) => [r.key, i + 1]),
  )
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each ring delivers up to its distance for its fee. Drag a ring&apos;s dot on the map to change its distance.
      </p>
      <div className="space-y-2">
        {rings.map((r) => {
          const e = errors[r.key] ?? {}
          const idx = sortedIndex.get(r.key)
          return (
            <div key={r.key} className="rounded-md border p-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: idx ? ringColor(idx) : "#d1d5db" }} />
                <span className="shrink-0">up to</span>
                <Input
                  className="h-8 w-20"
                  inputMode="decimal"
                  value={r.km}
                  aria-invalid={!!e.km}
                  disabled={readOnly}
                  onChange={(ev) => setRow(r.key, { km: ev.target.value })}
                  onBlur={() => edit((s) => ({ ...s, rings: sortRings(s.rings) }))}
                />
                <span className="shrink-0">km → €</span>
                <Input
                  className="h-8 w-20"
                  inputMode="decimal"
                  value={r.fee}
                  aria-invalid={!!e.fee}
                  disabled={readOnly}
                  onChange={(ev) => setRow(r.key, { fee: ev.target.value })}
                />
                <Button size="icon" variant="ghost" className="h-8 w-8" title="Show on map" onClick={() => onShow({ kind: "ring", id: r.key })}>
                  <MapPin className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  title="Remove ring"
                  disabled={readOnly}
                  onClick={() => edit((s) => ({ ...s, rings: s.rings.filter((x) => x.key !== r.key) }))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Input
                className="mt-2 h-8"
                placeholder="Label (optional)"
                value={r.label}
                maxLength={ZONE_LIMITS.maxLabel}
                disabled={readOnly}
                onChange={(ev) => setRow(r.key, { label: ev.target.value })}
              />
              {(e.km || e.fee) && <p className="mt-1 text-xs text-destructive">{[e.km && `Distance: ${e.km}`, e.fee && `Fee: ${e.fee}`].filter(Boolean).join(" · ")}</p>}
            </div>
          )
        })}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={readOnly || rings.length >= ZONE_LIMITS.maxRings}
        onClick={() =>
          edit((s) => {
            const maxKm = Math.max(0, ...s.rings.map((r) => parseKm(r.km) ?? 0)) / 1000
            const fee = s.rings.length ? (parseEuro(s.rings[s.rings.length - 1].fee) ?? 0) + 1 : 2
            return { ...s, rings: [...s.rings, { key: newId(), km: Math.min(50, maxKm + 1.5).toFixed(1), fee: feeInput(fee), label: "" }] }
          })
        }
      >
        <Plus className="mr-1 h-4 w-4" /> Add ring
      </Button>
      <p className="text-xs text-muted-foreground">
        Distances 0.1–50 km (one decimal). Fees in euros, e.g. 3,50 or 3.50. A blank fee is never saved as €0. A point exactly on a ring&apos;s edge belongs to the inner ring.
      </p>
    </div>
  )
}

// ---- 3. Cut ------------------------------------------------------------------------

export function CutStep({
  lines,
  drawing,
  selectedLineId,
  readOnly,
  issues,
  onDrawing,
  onSelect,
  edit,
}: {
  lines: EditorState["cut_lines"]
  drawing: boolean
  selectedLineId: string | null
  readOnly: boolean
  issues: ZoneIssue[]
  onDrawing: (v: boolean) => void
  onSelect: (id: string | null) => void
  edit: Edit
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Straight cut lines split the rings into pieces, e.g. along a river. Each line is extended automatically past the outer ring (dashed).
      </p>
      <Button
        variant={drawing ? "default" : "outline"}
        disabled={readOnly || (!drawing && lines.length >= ZONE_LIMITS.maxLines)}
        onClick={() => onDrawing(!drawing)}
      >
        {drawing ? "Cancel drawing" : "Draw cut line"}
      </Button>
      {drawing && <p className="text-xs text-muted-foreground">Click points on the map; click the last point again (double-click) to finish.</p>}
      <div className="space-y-2">
        {lines.length === 0 && <p className="text-sm text-muted-foreground">No cut lines.</p>}
        {lines.map((l, i) => {
          const lineIssues = issues.filter((x) => x.ref?.kind === "line" && x.ref.id === l.id)
          return (
            <div
              key={l.id}
              className={`rounded-md border p-2 ${selectedLineId === l.id ? "border-primary" : ""}`}
              onClick={() => onSelect(l.id)}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Line {i + 1}</span>
                <span className="text-xs text-muted-foreground">{l.points.length} points</span>
                <div className="flex-1" />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title="Delete line"
                  disabled={readOnly}
                  onClick={(e) => {
                    e.stopPropagation()
                    edit((s) => ({ ...s, cut_lines: s.cut_lines.filter((x) => x.id !== l.id) }))
                    if (selectedLineId === l.id) onSelect(null)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <Input
                className="mt-2 h-8"
                placeholder='Name, e.g. "river Bisagno"'
                value={l.label ?? ""}
                maxLength={ZONE_LIMITS.maxLabel}
                disabled={readOnly}
                onChange={(e) => edit((s) => ({ ...s, cut_lines: s.cut_lines.map((x) => (x.id === l.id ? { ...x, label: e.target.value } : x)) }))}
              />
              {lineIssues.map((x) => (
                <p key={x.code} className={`mt-1 text-xs ${x.severity === "blocker" ? "text-destructive" : "text-amber-700"}`}>
                  {x.message}
                </p>
              ))}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">Select a line to drag its points. Straight segments only.</p>
    </div>
  )
}

// ---- 4. Pieces ---------------------------------------------------------------------

export function pieceState(p: { deliverable: boolean; rule_id: string | null }): "ring fee" | "custom fee" | "no delivery" {
  if (!p.deliverable) return "no delivery"
  return p.rule_id ? "custom fee" : "ring fee"
}

export function PiecesStep({
  pieces,
  hover,
  onHover,
  onShow,
}: {
  pieces: PieceCollection | null
  hover: string | null
  onHover: (id: string | null) => void
  onShow: (ref: IssueRef) => void
}) {
  const list = pieces?.features ?? []
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Click a piece on the map to set it to the ring fee, a custom fee, or no delivery. Drag the small pins to move a setting.
      </p>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pieces yet: add a center point and rings.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ring</TableHead>
              <TableHead>Fee</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Area</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((f) => {
              const p = f.properties
              return (
                <TableRow
                  key={f.id}
                  className={`cursor-pointer ${hover === f.id ? "bg-accent" : ""}`}
                  onMouseEnter={() => onHover(f.id)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onShow({ kind: "piece", id: f.id })}
                >
                  <TableCell>
                    <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: ringColor(p.ring_index) }} />
                    {p.ring_index}
                  </TableCell>
                  <TableCell>{p.deliverable ? formatEuro(p.fee) : "—"}</TableCell>
                  <TableCell>
                    <div>{pieceState(p)}</div>
                    {p.label && <div className="text-xs text-muted-foreground">{p.label}</div>}
                  </TableCell>
                  <TableCell className="text-right text-xs">{formatArea(p.area_m2)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

export interface PiecePopoverState {
  pieceId: string
  at: LatLng
  pixel: { x: number; y: number }
}

export function PiecePopover({
  popover,
  state,
  pieces,
  onClose,
  edit,
}: {
  popover: PiecePopoverState
  state: EditorState
  pieces: PieceCollection | null
  onClose: () => void
  edit: Edit
}) {
  const piece = pieces?.features.find((f) => f.id === popover.pieceId)
  const rule = piece?.properties.rule_id ? state.rules.find((u) => u.id === piece.properties.rule_id) : undefined
  const ringRow = state.rings.find((r) => parseKm(r.km) === piece?.properties.radius_m)
  const ringFee = ringRow ? parseEuro(ringRow.fee) : null
  const [mode, setMode] = useState<RuleMode>(rule?.mode ?? (piece && !piece.properties.deliverable ? "excluded" : "ring_fee"))
  const [fee, setFee] = useState(rule?.fee !== null && rule?.fee !== undefined ? feeInput(rule.fee) : "")
  const [label, setLabel] = useState(rule?.label ?? "")
  if (!piece) return null
  const customFee = parseEuro(fee)
  const invalid = mode === "custom_fee" && customFee === null

  const apply = () => {
    if (invalid) return
    const trimmed = label.trim() || null
    edit((s) => {
      // "Ring fee" without a label needs no rule.
      if (mode === "ring_fee" && !trimmed) return { ...s, rules: s.rules.filter((u) => u.id !== rule?.id) }
      const next = { mode, fee: mode === "custom_fee" ? customFee : null, label: trimmed }
      if (rule) return { ...s, rules: s.rules.map((u) => (u.id === rule.id ? { ...u, ...next } : u)) }
      return { ...s, rules: [...s.rules, { id: newId(), anchor: popover.at, ...next }] }
    })
    onClose()
  }

  return (
    <div
      className="absolute z-10 w-72 rounded-md border bg-popover p-3 text-sm shadow-lg"
      style={{ left: Math.max(16, Math.min(popover.pixel.x + 12, 9999)), top: Math.max(16, popover.pixel.y - 20) }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium">Ring {piece.properties.ring_index} piece</span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "ring_fee"} onChange={() => setMode("ring_fee")} />
          Ring fee ({formatEuro(ringFee)})
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "custom_fee"} onChange={() => setMode("custom_fee")} />
          Custom fee €
          <Input
            className="h-7 w-20"
            inputMode="decimal"
            value={fee}
            aria-invalid={mode === "custom_fee" && invalid}
            onFocus={() => setMode("custom_fee")}
            onChange={(e) => setFee(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "excluded"} onChange={() => setMode("excluded")} />
          Don&apos;t deliver
        </label>
        <div className="space-y-1">
          <Label className="text-xs">Label (optional)</Label>
          <Input className="h-8" value={label} maxLength={ZONE_LIMITS.maxLabel} onChange={(e) => setLabel(e.target.value)} />
        </div>
        {rule && (
          <p className="text-xs text-muted-foreground">
            Setting pinned {formatDistance(distanceM(rule.anchor, popover.at))} from where you clicked.
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          {piece.properties.rule_id && <Badge variant="secondary">has a setting</Badge>}
          <Button size="sm" onClick={apply} disabled={invalid}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  )
}
