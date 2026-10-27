"use client"

// Step 6: review and publish. The review sits in the side panel (not a modal)
// so the Draft / Live / Both map toggle stays usable; the final confirmation
// is a dialog.

import { useMemo, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { buildPayload, type EditorState } from "@/lib/zones/editor-state"
import { formatEuro, formatKm } from "@/lib/zones/units"
import type { ExtendedLine, IssueRef, PieceCollection, ZoneIssue, ZoneSetView } from "@/lib/zones/types"
import type { MapLayers } from "./zone-map"

interface Computed {
  revision: number
  pieces: PieceCollection | null
  issues: ZoneIssue[]
  extended_lines: ExtendedLine[]
}

function summary(pieces: PieceCollection | null) {
  const list = pieces?.features ?? []
  return {
    count: list.length,
    excludedKm2: list.filter((f) => !f.properties.deliverable).reduce((a, f) => a + f.properties.area_m2, 0) / 1_000_000,
    custom: list.filter((f) => f.properties.deliverable && f.properties.rule_id).length,
  }
}

export function PublishStep(props: {
  businessId: string
  draftVersion: number
  computed: Computed
  state: EditorState
  published: ZoneSetView | null
  layers: MapLayers
  saving: boolean
  saveBlocked: string | null
  readOnly: boolean
  revision: () => number
  onLayers: (l: MapLayers) => void
  onShow: (ref: IssueRef) => void
  onIssues: (issues: ZoneIssue[]) => void
  onConflict: () => void
  onPublished: (version: number) => Promise<void>
}) {
  const { computed, published } = props
  const [ack, setAck] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blockers = computed.issues.filter((i) => i.severity === "blocker")
  const warnings = computed.issues.filter((i) => i.severity === "warning")
  const draftRings = useMemo(() => {
    const b = buildPayload(props.state)
    return b.ok ? b.payload.rings : []
  }, [props.state])
  const d = summary(computed.pieces)
  const l = summary(published?.pieces ?? null)

  const canPublish =
    !props.readOnly && !props.saving && !props.saveBlocked && blockers.length === 0 && (warnings.length === 0 || ack) && !!computed.pieces

  const publish = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/zones/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ business_id: props.businessId, expected_revision: props.revision(), acknowledge_warnings: ack }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 409) {
        setConfirming(false)
        return props.onConflict()
      }
      if (res.status === 422) {
        props.onIssues((j.issues ?? []) as ZoneIssue[])
        setAck(false)
        setConfirming(false)
        return setError(j.error === "publish_blocked" ? "Publishing is blocked: fix the problems listed." : "Review the warnings, then confirm again.")
      }
      if (!res.ok) throw new Error()
      setConfirming(false)
      setAck(false)
      await props.onPublished(j.published_version as number)
    } catch {
      setError("Could not publish. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {(["draft", "live", "both"] as const).map((v) => (
          <Button key={v} size="sm" variant={props.layers === v ? "default" : "outline"} onClick={() => props.onLayers(v)} disabled={v !== "draft" && !published}>
            {v === "draft" ? "Draft" : v === "live" ? "Live" : "Both"}
          </Button>
        ))}
      </div>

      {props.saving && <p className="text-xs text-muted-foreground">Waiting for the draft to save…</p>}
      {props.saveBlocked && <p className="text-xs text-amber-700">{props.saveBlocked}</p>}

      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Blockers ({blockers.length})</h3>
        {blockers.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
        {blockers.map((i, n) => (
          <IssueRow key={`b${n}`} issue={i} onShow={props.onShow} />
        ))}
      </section>

      <section className="space-y-1">
        <h3 className="text-sm font-semibold">Warnings ({warnings.length})</h3>
        {warnings.length === 0 && <p className="text-sm text-muted-foreground">None.</p>}
        {warnings.map((i, n) => (
          <IssueRow key={`w${n}`} issue={i} onShow={props.onShow} />
        ))}
        {warnings.length > 0 && (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            I&apos;ve reviewed these warnings
          </label>
        )}
      </section>

      <Separator />

      <section className="space-y-2 text-sm">
        <h3 className="font-semibold">Draft vs live</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="font-normal">Ring</th>
              <th className="font-normal">Draft</th>
              <th className="font-normal">Live</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.max(draftRings.length, published?.rings.length ?? 0) }).map((_, i) => {
              const dr = draftRings[i]
              const lr = published?.rings[i]
              const diff = !dr || !lr || dr.radius_m !== lr.radius_m || dr.fee !== lr.fee || (dr.min_order ?? 0) !== (lr.min_order ?? 0)
              const ring = (r: { radius_m: number; fee: number; min_order?: number }) =>
                `${formatKm(r.radius_m)} km · ${formatEuro(r.fee)}${r.min_order ? ` · min. ${formatEuro(r.min_order)}` : ""}`
              return (
                <tr key={i} className={diff ? "font-medium" : ""}>
                  <td>{i + 1}</td>
                  <td>{dr ? ring(dr) : "—"}</td>
                  <td>{lr ? ring(lr) : "—"}</td>
                </tr>
              )
            })}
            <tr>
              <td>Pieces</td>
              <td>{d.count}</td>
              <td>{published ? l.count : "—"}</td>
            </tr>
            <tr>
              <td>Not delivered</td>
              <td>{d.excludedKm2.toFixed(2)} km²</td>
              <td>{published ? `${l.excludedKm2.toFixed(2)} km²` : "—"}</td>
            </tr>
            <tr>
              <td>Custom-fee pieces</td>
              <td>{d.custom}</td>
              <td>{published ? l.custom : "—"}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">Live pieces are outlined in orange on the map.</p>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button className="w-full" disabled={!canPublish} onClick={() => setConfirming(true)}>
        Publish version {props.draftVersion}
      </Button>

      <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish version {props.draftVersion}?</DialogTitle>
            <DialogDescription>Customers checking out right now may see a new delivery fee.</DialogDescription>
          </DialogHeader>
          {warnings.length > 0 && <p className="text-sm text-amber-700">{warnings.length} warning(s) acknowledged.</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void publish()} disabled={busy}>
              {busy ? "Publishing…" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function IssueRow({ issue, onShow }: { issue: ZoneIssue; onShow: (ref: IssueRef) => void }) {
  const tone = issue.severity === "blocker" ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-amber-500/40 bg-amber-50 text-amber-800"
  return (
    <div className={`rounded-md border px-2 py-1.5 text-sm ${tone}`}>
      <div>{issue.message}</div>
      <div className="flex items-center justify-between text-[11px] opacity-80">
        <code>{issue.code}</code>
        {issue.ref && (
          <button type="button" className="underline" onClick={() => onShow(issue.ref as IssueRef)}>
            show on map
          </button>
        )}
      </div>
    </div>
  )
}
