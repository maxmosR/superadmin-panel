"use client"

// Step 7: published versions, view one on the map (read-only), or restore it
// into the draft. Restoring never changes the old version; publishing the
// draft then makes a new one.

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ZoneSetView, ZoneVersionRow } from "@/lib/zones/types"
import { useI18n } from "@/lib/i18n/client"
import { useConfirm } from "../confirm-dialog"

export function HistoryStep(props: {
  businessId: string
  versions: ZoneVersionRow[]
  viewingVersion: number | null
  readOnly: boolean
  revision: () => number
  onView: (v: ZoneSetView | null) => void
  onRestored: (draft: ZoneSetView, version: number) => void
  onConflict: () => void
}) {
  const { t, fmt, locale } = useI18n()
  const { confirm, dialog } = useConfirm()
  const rome = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" })
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const view = async (version: number) => {
    setBusy(version)
    setError(null)
    try {
      const res = await fetch(`/api/zones/version?business_id=${encodeURIComponent(props.businessId)}&version=${version}`, { cache: "no-store" })
      if (!res.ok) throw new Error()
      props.onView(((await res.json()) as { zone_set: ZoneSetView }).zone_set)
    } catch {
      setError(t.zones.viewFailed)
    } finally {
      setBusy(null)
    }
  }

  const restore = async (version: number) => {
    const ok = await confirm({
      title: fmt(t.zones.restoreTitle, { v: version }),
      description: fmt(t.zones.restoreBody, { v: version }),
      confirmLabel: t.zones.restoreConfirm,
      destructive: true,
    })
    if (!ok) return
    setBusy(version)
    setError(null)
    try {
      const res = await fetch("/api/zones/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ business_id: props.businessId, version, expected_revision: props.revision() }),
      })
      if (res.status === 409) return props.onConflict()
      if (!res.ok) throw new Error()
      props.onRestored(((await res.json()) as { draft: ZoneSetView }).draft, version)
    } catch {
      setError(t.zones.restoreFailed)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      {props.versions.length === 0 && <p className="text-sm text-muted-foreground">{t.zones.nothingYet}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="space-y-2">
        {props.versions.map((v) => (
          <li key={v.version} className="rounded-md border p-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{fmt(t.zones.version, { v: v.version })}</span>
              {v.status === "published" ? (
                <Badge variant="outline" className="border-green-700/40 text-green-700">
                  {t.zones.liveBadge}
                </Badge>
              ) : (
                <Badge variant="secondary">{t.zones.archived}</Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {v.published_at ? rome.format(new Date(v.published_at)) : "—"} · {v.published_by_email ?? t.zones.unknownOperator}
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant={props.viewingVersion === v.version ? "secondary" : "outline"}
                disabled={busy !== null}
                onClick={() => (props.viewingVersion === v.version ? props.onView(null) : void view(v.version))}
              >
                {props.viewingVersion === v.version ? t.zones.closeView : t.zones.viewOnMap}
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null || props.readOnly} onClick={() => void restore(v.version)}>
                {t.zones.restore}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {dialog}
    </div>
  )
}
