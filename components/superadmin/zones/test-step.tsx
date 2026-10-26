"use client"

// Step 5: test any address against the draft and the live version. Both
// answers come from the same SQL core that will price real orders.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { formatLatLng, parseLatLngText } from "@/lib/zones/geo"
import { formatDistance, formatEuro } from "@/lib/zones/units"
import type { LatLng, QuoteResult } from "@/lib/zones/types"
import { PlacesSearch } from "./places-search"

export interface ZoneTest {
  point: LatLng
  label: string | null
  streetOnly: boolean
  draft: QuoteResult | null
  published: QuoteResult | null
  /** The draft answer changed after the last save. */
  changed: boolean
  at: string
}

const MAX_RECENT = 10

/** A short, comparable summary of a quote. */
export function quoteSummary(q: QuoteResult | null): string {
  if (!q) return "—"
  switch (q.status) {
    case "ok":
      return formatEuro(q.fee)
    case "excluded_area":
      return "not delivered here"
    case "outside_area":
      return "outside the area"
    case "no_zones":
      return "no zones"
  }
}

export function useZoneTests(businessId: string, slug: string) {
  const storageKey = `birraora-zone-tests:${slug}`
  const [recent, setRecent] = useState<ZoneTest[]>([])
  const [current, setCurrent] = useState<ZoneTest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recentRef = useRef<ZoneTest[]>([])

  // Recent tests survive reloads in this browser (best effort).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      const list = raw ? (JSON.parse(raw) as ZoneTest[]) : []
      if (Array.isArray(list)) {
        recentRef.current = list.slice(0, MAX_RECENT)
        setRecent(recentRef.current)
      }
    } catch {
      // storage unavailable
    }
  }, [storageKey])

  const store = useCallback(
    (list: ZoneTest[]) => {
      recentRef.current = list
      setRecent(list)
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(list))
      } catch {
        // storage unavailable
      }
    },
    [storageKey],
  )

  const quote = useCallback(
    async (p: LatLng) => {
      const res = await fetch("/api/zones/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ business_id: businessId, lat: p.lat, lng: p.lng }),
      })
      if (!res.ok) throw new Error(`test failed (${res.status})`)
      return (await res.json()) as { draft: QuoteResult | null; published: QuoteResult | null }
    },
    [businessId],
  )

  const run = useCallback(
    async (point: LatLng, label: string | null, streetOnly = false) => {
      setBusy(true)
      setError(null)
      try {
        const r = await quote(point)
        const t: ZoneTest = { point, label, streetOnly, draft: r.draft, published: r.published, changed: false, at: new Date().toISOString() }
        setCurrent(t)
        const others = recentRef.current.filter((x) => formatLatLng(x.point) !== formatLatLng(point))
        store([t, ...others].slice(0, MAX_RECENT))
      } catch {
        setError("Could not test this point. Try again.")
      } finally {
        setBusy(false)
      }
    },
    [quote, store],
  )

  /** After every draft save: re-test the recent points and mark changes. */
  const rerunAll = useCallback(async () => {
    const list = recentRef.current
    if (!list.length) return
    const next = await Promise.all(
      list.map(async (t) => {
        try {
          const r = await quote(t.point)
          const changed = quoteSummary(r.draft) !== quoteSummary(t.draft) || t.changed
          return { ...t, draft: r.draft, published: r.published, changed }
        } catch {
          return t
        }
      }),
    )
    store(next)
    setCurrent((c) => (c ? (next.find((t) => formatLatLng(t.point) === formatLatLng(c.point)) ?? c) : c))
  }, [quote, store])

  const clearChanged = useCallback(() => store(recentRef.current.map((t) => ({ ...t, changed: false }))), [store])

  return useMemo(
    () => ({ recent, current, busy, error, run, rerunAll, clearChanged, select: setCurrent }),
    [recent, current, busy, error, run, rerunAll, clearChanged],
  )
}

export type ZoneTests = ReturnType<typeof useZoneTests>

function QuoteBlock({ title, q }: { title: string; q: QuoteResult | null }) {
  return (
    <div className="flex-1 rounded-md border p-2">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="text-lg font-semibold">{quoteSummary(q)}</div>
      {q && q.status !== "no_zones" && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {q.ring_index !== null && <div>Ring {q.ring_index}{q.label ? ` · ${q.label}` : ""}</div>}
          <div>{formatDistance(q.distance_m)} from the center</div>
        </div>
      )}
    </div>
  )
}

export function TestStep({ tests, bias }: { tests: ZoneTests; bias: { center: LatLng; radiusM: number } | null }) {
  const [text, setText] = useState("")
  const typed = parseLatLngText(text)
  const c = tests.current
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Search an address, click the map, or paste coordinates.</p>
      <PlacesSearch bias={bias} placeholder="Test an address" onPick={(p) => void tests.run(p.point, p.formatted, p.streetOnly)} />
      <div className="flex gap-2">
        <Input placeholder="lat, lng" value={text} onChange={(e) => setText(e.target.value)} />
        <Button variant="outline" disabled={!typed || tests.busy} onClick={() => typed && void tests.run(typed, null)}>
          Test
        </Button>
      </div>
      {tests.error && <p className="text-sm text-destructive">{tests.error}</p>}
      {c && (
        <div className="space-y-2">
          <div className="text-sm">
            <div className="font-medium">{c.label ?? formatLatLng(c.point)}</div>
            {c.streetOnly && (
              <p className="text-xs text-amber-700">street only: the point is the street&apos;s middle, fees may differ along it</p>
            )}
          </div>
          <div className="flex gap-2">
            <QuoteBlock title="Draft" q={c.draft} />
            <QuoteBlock title="Live" q={c.published} />
          </div>
        </div>
      )}
      <Separator />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium">Recent tests</span>
          {tests.recent.some((t) => t.changed) && (
            <Button size="sm" variant="ghost" onClick={tests.clearChanged}>
              Clear marks
            </Button>
          )}
        </div>
        {tests.recent.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
        <ul className="space-y-1">
          {tests.recent.map((t) => (
            <li key={formatLatLng(t.point)}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-sm hover:bg-accent"
                onClick={() => tests.select(t)}
              >
                <span className="truncate">
                  {t.changed && <span className="mr-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">changed</span>}
                  {t.label ?? formatLatLng(t.point)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  Draft: {quoteSummary(t.draft)} · Live: {quoteSummary(t.published)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
