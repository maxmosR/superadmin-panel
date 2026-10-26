"use client"

// Step 7: published versions, view one on the map (read-only), or restore it
// into the draft. Restoring never changes the old version; publishing the
// draft then makes a new one.

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ZoneSetView, ZoneVersionRow } from "@/lib/zones/types"

const rome = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" })

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
      setError("Could not load that version.")
    } finally {
      setBusy(null)
    }
  }

  const restore = async (version: number) => {
    if (!window.confirm(`Replace the draft with a copy of version ${version}?`)) return
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
      setError("Could not restore that version.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      {props.versions.length === 0 && <p className="text-sm text-muted-foreground">Nothing published yet.</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="space-y-2">
        {props.versions.map((v) => (
          <li key={v.version} className="rounded-md border p-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">Version {v.version}</span>
              {v.status === "published" ? <Badge>live</Badge> : <Badge variant="secondary">archived</Badge>}
            </div>
            <div className="text-xs text-muted-foreground">
              {v.published_at ? rome.format(new Date(v.published_at)) : "—"} · {v.published_by_email ?? "unknown operator"}
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant={props.viewingVersion === v.version ? "default" : "outline"}
                disabled={busy !== null}
                onClick={() => (props.viewingVersion === v.version ? props.onView(null) : void view(v.version))}
              >
                {props.viewingVersion === v.version ? "Close view" : "View on map"}
              </Button>
              <Button size="sm" variant="outline" disabled={busy !== null || props.readOnly} onClick={() => void restore(v.version)}>
                Restore as draft
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
