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
import { useI18n } from "@/lib/i18n/client"
import { issueText } from "./zone-text"

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
  const { t, fmt } = useI18n()
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
        return setError(j.error === "publish_blocked" ? t.zones.publishBlocked : t.zones.reviewWarnings)
      }
      if (!res.ok) throw new Error()
      setConfirming(false)
      setAck(false)
      await props.onPublished(j.published_version as number)
    } catch {
      setError(t.zones.publishFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div role="group" aria-label={t.zones.mapLayers} className="flex gap-1">
        {(["draft", "live", "both"] as const).map((v) => (
          <Button
            key={v}
            size="sm"
            variant={props.layers === v ? "secondary" : "outline"}
            aria-pressed={props.layers === v}
            onClick={() => props.onLayers(v)}
            disabled={v !== "draft" && !published}
          >
            {v === "draft" ? t.zones.draft : v === "live" ? t.zones.live : t.zones.both}
          </Button>
        ))}
      </div>

      {props.saving && <p className="text-xs text-muted-foreground">{t.zones.waitingSave}</p>}
      {props.saveBlocked && <p className="text-xs text-amber-700">{props.saveBlocked}</p>}

      <section className="space-y-1">
        <h3 className="text-sm font-semibold">{fmt(t.zones.blockers, { n: blockers.length })}</h3>
        {blockers.length === 0 && <p className="text-sm text-muted-foreground">{t.zones.none}</p>}
        {blockers.map((i, n) => (
          <IssueRow key={`b${n}`} issue={i} onShow={props.onShow} />
        ))}
      </section>

      <section className="space-y-1">
        <h3 className="text-sm font-semibold">{fmt(t.zones.warnings, { n: warnings.length })}</h3>
        {warnings.length === 0 && <p className="text-sm text-muted-foreground">{t.zones.none}</p>}
        {warnings.map((i, n) => (
          <IssueRow key={`w${n}`} issue={i} onShow={props.onShow} />
        ))}
        {warnings.length > 0 && (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            {t.zones.reviewed}
          </label>
        )}
      </section>

      <Separator />

      <section className="space-y-2 text-sm">
        <h3 className="font-semibold">{t.zones.draftVsLive}</h3>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="font-normal">{t.zones.colRing}</th>
              <th className="font-normal">{t.zones.colDraft}</th>
              <th className="font-normal">{t.zones.colLive}</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.max(draftRings.length, published?.rings.length ?? 0) }).map((_, i) => {
              const dr = draftRings[i]
              const lr = published?.rings[i]
              const diff = !dr || !lr || dr.radius_m !== lr.radius_m || dr.fee !== lr.fee || (dr.min_order ?? 0) !== (lr.min_order ?? 0)
              const ring = (r: { radius_m: number; fee: number; min_order?: number }) =>
                `${formatKm(r.radius_m)} km · ${formatEuro(r.fee)}${r.min_order ? ` · ${fmt(t.zones.quote.min, { v: formatEuro(r.min_order) })}` : ""}`
              return (
                <tr key={i} className={diff ? "font-medium" : ""}>
                  <td>{i + 1}</td>
                  <td>{dr ? ring(dr) : "—"}</td>
                  <td>{lr ? ring(lr) : "—"}</td>
                </tr>
              )
            })}
            <tr>
              <td>{t.zones.rowPieces}</td>
              <td>{d.count}</td>
              <td>{published ? l.count : "—"}</td>
            </tr>
            <tr>
              <td>{t.zones.rowNotDelivered}</td>
              <td>{d.excludedKm2.toFixed(2)} km²</td>
              <td>{published ? `${l.excludedKm2.toFixed(2)} km²` : "—"}</td>
            </tr>
            <tr>
              <td>{t.zones.rowCustom}</td>
              <td>{d.custom}</td>
              <td>{published ? l.custom : "—"}</td>
            </tr>
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">{t.zones.liveOutline}</p>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button className="w-full" disabled={!canPublish} onClick={() => setConfirming(true)}>
        {fmt(t.zones.publishVersion, { v: props.draftVersion })}
      </Button>

      <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{fmt(t.zones.publishTitle, { v: props.draftVersion })}</DialogTitle>
            <DialogDescription>{t.zones.publishBody}</DialogDescription>
          </DialogHeader>
          {warnings.length > 0 && <p className="text-sm text-amber-700">{t.zones.acknowledged(warnings.length)}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              {t.common.cancel}
            </Button>
            <Button onClick={() => void publish()} disabled={busy}>
              {busy ? t.zones.publishing : t.zones.publish}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function IssueRow({ issue, onShow }: { issue: ZoneIssue; onShow: (ref: IssueRef) => void }) {
  const { t } = useI18n()
  const tone = issue.severity === "blocker" ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-amber-500/40 bg-amber-50 text-amber-800"
  return (
    <div className={`rounded-md border px-2 py-1.5 text-sm ${tone}`}>
      <div>{issueText(t, issue)}</div>
      <div className="flex items-center justify-between text-xs opacity-80">
        <code>{issue.code}</code>
        {issue.ref && (
          <button type="button" className="underline" onClick={() => onShow(issue.ref as IssueRef)}>
            {t.zones.showIssue}
          </button>
        )}
      </div>
    </div>
  )
}
