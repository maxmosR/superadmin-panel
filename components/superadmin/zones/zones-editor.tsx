"use client"

// Delivery zones editor for one restaurant. Every edit goes into the draft
// (autosaved 800 ms after the last change); the server recomputes the pieces
// and the issues. Publishing makes the draft a new, immutable version.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Download, Loader2, RotateCcw, Upload } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { createAutosave, type Autosave, type AutosaveStatus } from "@/lib/zones/autosave"
import {
  buildPayload,
  EMPTY_STATE,
  exportJson,
  parseImportJson,
  stateFromPayload,
  stateFromView,
  type EditorState,
} from "@/lib/zones/editor-state"
import { distanceM } from "@/lib/zones/geo"
import { parseKm } from "@/lib/zones/units"
import type {
  DraftPayload,
  ExtendedLine,
  IssueRef,
  LatLng,
  PieceCollection,
  SaveResult,
  ZoneIssue,
  ZonesOverview,
  ZoneSetView,
} from "@/lib/zones/types"
import { ZONE_LIMITS } from "@/lib/zones/types"
import { ZoneMap, type EditorStep, type MapLayers } from "./zone-map"
import { CenterStep, CutStep, PiecesStep, RingsStep, PiecePopover, type PiecePopoverState } from "./zone-steps"
import { TestStep, useZoneTests } from "./test-step"
import { PublishStep } from "./publish-step"
import { HistoryStep } from "./history-step"

const STEPS: Array<{ id: EditorStep; label: string }> = [
  { id: "center", label: "1. Center" },
  { id: "rings", label: "2. Rings" },
  { id: "cut", label: "3. Cut" },
  { id: "pieces", label: "4. Pieces" },
  { id: "test", label: "5. Test" },
  { id: "publish", label: "6. Publish" },
  { id: "history", label: "7. History" },
]

interface Computed {
  revision: number
  pieces: PieceCollection | null
  issues: ZoneIssue[]
  extended_lines: ExtendedLine[]
}

const NO_COMPUTED: Computed = { revision: 0, pieces: null, issues: [], extended_lines: [] }

function computedFrom(view: ZoneSetView | null): Computed {
  return view
    ? { revision: view.revision, pieces: view.pieces, issues: view.issues ?? [], extended_lines: view.extended_lines ?? [] }
    : NO_COMPUTED
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)")
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])
  return narrow
}

export function ZonesEditor({ businessId }: { businessId: string }) {
  const [overview, setOverview] = useState<ZonesOverview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [state, setState] = useState<EditorState>(EMPTY_STATE)
  const [computed, setComputed] = useState<Computed>(NO_COMPUTED)
  const [saveStatus, setSaveStatus] = useState<AutosaveStatus>("idle")
  const [saveBlocked, setSaveBlocked] = useState<string | null>(null)
  const [step, setStep] = useState<EditorStep>("center")
  const [drawing, setDrawing] = useState(false)
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  const [hoverPiece, setHoverPiece] = useState<string | null>(null)
  const [highlightPiece, setHighlightPiece] = useState<string | null>(null)
  const [focus, setFocus] = useState<(IssueRef & { nonce: number }) | null>(null)
  const [popover, setPopover] = useState<PiecePopoverState | null>(null)
  const [layers, setLayers] = useState<MapLayers>("draft")
  const [viewing, setViewing] = useState<ZoneSetView | null>(null)
  const [resyncNonce, setResyncNonce] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const narrow = useNarrow()

  const revisionRef = useRef(0)
  const autosaveRef = useRef<Autosave<DraftPayload> | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const afterSaveRef = useRef<() => void>(() => {})

  const readOnly = narrow || viewing !== null || saveStatus === "conflict"

  // ---- loading ------------------------------------------------------------------
  const applyDraft = useCallback((draft: ZoneSetView | null, fallbackOrigin: LatLng | null) => {
    autosaveRef.current?.reset()
    const c = computedFrom(draft)
    revisionRef.current = c.revision
    setComputed(c)
    setState(draft ? stateFromView(draft) : { ...EMPTY_STATE, origin: fallbackOrigin })
    setSelectedLineId(null)
    setPopover(null)
    setResyncNonce((n) => n + 1)
  }, [])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/zones?business_id=${encodeURIComponent(businessId)}`, { cache: "no-store" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error === "business_not_found" ? "Restaurant not found." : `Could not load zones (${j.error ?? res.status}).`)
      const o = j as ZonesOverview
      setOverview(o)
      const bizOrigin = o.business.latitude !== null && o.business.longitude !== null ? { lat: o.business.latitude, lng: o.business.longitude } : null
      applyDraft(o.draft, o.published?.origin ?? bizOrigin)
      return o
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load zones.")
      return null
    }
  }, [businessId, applyDraft])

  useEffect(() => {
    void load()
  }, [load])

  // First open with no coordinates: find the restaurant's address with Places.
  useEffect(() => {
    if (!overview || state.origin || overview.draft || !overview.business.address) return
    let cancelled = false
    void (async () => {
      try {
        const { loadGoogleMaps } = await import("@/lib/google-maps/loader")
        const g = await loadGoogleMaps()
        const { Place } = (await g.maps.importLibrary("places")) as google.maps.PlacesLibrary
        const { places } = await Place.searchByText({ textQuery: overview.business.address as string, fields: ["location"], maxResultCount: 1 })
        const loc = places[0]?.location
        if (!cancelled && loc) {
          setState((s) => (s.origin ? s : { ...s, origin: { lat: loc.lat(), lng: loc.lng() } }))
          setNotice("Center point placed at the restaurant's address. Check it, then drag the pin if needed.")
        }
      } catch {
        // The operator searches or clicks instead.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [overview, state.origin])

  // ---- autosave -------------------------------------------------------------------
  useEffect(() => {
    const autosave = createAutosave<DraftPayload>({
      delayMs: 800,
      onStatus: setSaveStatus,
      send: async (payload) => {
        const res = await fetch("/api/zones/draft", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ business_id: businessId, expected_revision: revisionRef.current, ...payload }),
        })
        if (res.status === 409) return "conflict"
        if (!res.ok) return "error"
        const j = (await res.json()) as SaveResult
        revisionRef.current = j.revision
        setComputed({ revision: j.revision, pieces: j.pieces, issues: j.issues ?? [], extended_lines: j.extended_lines ?? [] })
        afterSaveRef.current()
        return "ok"
      },
    })
    autosaveRef.current = autosave
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (autosave.hasPending()) {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      autosave.reset()
    }
  }, [businessId])

  /** Apply an edit locally at once, then queue the save. */
  const edit = useCallback((fn: (s: EditorState) => EditorState) => {
    setState((prev) => {
      const next = fn(prev)
      const built = buildPayload(next)
      if (built.ok) {
        setSaveBlocked(null)
        autosaveRef.current?.schedule(built.payload)
      } else {
        setSaveBlocked(built.reason)
      }
      return next
    })
  }, [])

  // ---- tests (re-run after every save) ----------------------------------------
  const tests = useZoneTests(businessId, overview?.business.slug ?? businessId)
  useEffect(() => {
    afterSaveRef.current = () => void tests.rerunAll()
  }, [tests])

  // ---- derived ----------------------------------------------------------------------
  const ringsForMap = useMemo(
    () => state.rings.flatMap((r) => {
      const m = parseKm(r.km)
      return m === null ? [] : [{ key: r.key, radiusM: m }]
    }),
    [state.rings],
  )
  const outerM = ringsForMap.reduce((m, r) => Math.max(m, r.radiusM), 0)
  const published = overview?.published ?? null
  const hasPublished = !!published

  // ---- map callbacks ----------------------------------------------------------------
  const moveOrigin = useCallback(
    (p: LatLng) => {
      const cur = state.origin
      if (cur && distanceM(cur, p) > ZONE_LIMITS.originMovedM) {
        const ok = window.confirm(`Move the center point by ${Math.round(distanceM(cur, p))} m?`)
        if (!ok) {
          setResyncNonce((n) => n + 1)
          return
        }
      }
      edit((s) => ({ ...s, origin: p }))
    },
    [state.origin, edit],
  )

  const onLinesChange = useCallback(
    (lines: Array<{ id: string; points: LatLng[] }>) =>
      edit((s) => {
        const labels = new Map(s.cut_lines.map((c) => [c.id, c.label]))
        const next = lines.map((l) => ({ id: l.id, points: l.points, label: labels.get(l.id) ?? null }))
        const same =
          next.length === s.cut_lines.length &&
          next.every((l, i) => l.id === s.cut_lines[i].id && JSON.stringify(l.points) === JSON.stringify(s.cut_lines[i].points))
        return same ? s : { ...s, cut_lines: next }
      }),
    [edit],
  )

  const onRingRadiusChange = useCallback(
    (key: string, m: number) =>
      edit((s) => ({ ...s, rings: s.rings.map((r) => (r.key === key ? { ...r, km: (m / 1000).toFixed(1) } : r)) })),
    [edit],
  )

  const showOnMap = useCallback((ref: IssueRef) => {
    setFocus({ ...ref, nonce: Date.now() })
    if (ref.kind === "piece") setHighlightPiece(ref.id)
    if (ref.kind === "line") setSelectedLineId(ref.id)
  }, [])

  // ---- draft actions --------------------------------------------------------------
  const discard = async () => {
    if (!window.confirm(hasPublished ? "Discard all unpublished changes and go back to the live version?" : "Delete this draft? Nothing is published yet.")) return
    const res = await fetch("/api/zones/draft/discard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ business_id: businessId, expected_revision: revisionRef.current }),
    })
    if (res.status === 409) return setSaveStatus("conflict")
    if (!res.ok) return setNotice("Could not discard the draft. Try again.")
    await load()
    setNotice("Draft discarded.")
  }

  const doExport = () => {
    const built = buildPayload(state)
    if (!built.ok) return setNotice(built.reason)
    const blob = new Blob([exportJson(built.payload, { slug: overview?.business.slug ?? "", exported_at: new Date().toISOString() })], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `delivery-zones-${overview?.business.slug ?? "restaurant"}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const doImport = async (file: File) => {
    const parsed = parseImportJson(await file.text())
    if (!parsed.ok) return setNotice(`Import failed: ${parsed.error}`)
    if (!window.confirm("Replace the draft with the imported file?")) return
    edit(() => stateFromPayload(parsed.payload))
    setResyncNonce((n) => n + 1)
    autosaveRef.current?.flush()
    setNotice("Imported. The draft is being saved and checked.")
  }

  // ---- render -------------------------------------------------------------------------
  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
        <Button className="mt-4" variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </div>
    )
  }
  if (!overview) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading delivery zones…
      </div>
    )
  }

  const draftVersion = overview.draft?.version ?? (overview.versions[0]?.version ?? 0) + 1
  const blockers = computed.issues.filter((i) => i.severity === "blocker")
  const mapPieces = viewing ? viewing.pieces : computed.pieces

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/">
                <ArrowLeft className="mr-1 h-4 w-4" /> Restaurants
              </Link>
            </Button>
            <div>
              <div className="font-semibold">Delivery zones · {overview.business.business_name}</div>
              <div className="text-xs text-muted-foreground">
                {hasPublished ? `Live: version ${published?.version}` : "Nothing published"} · Draft: version {draftVersion}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SaveIndicator status={saveStatus} blocked={saveBlocked} onRetry={() => autosaveRef.current?.retry()} />
            <Button variant="outline" size="sm" onClick={doExport} disabled={readOnly && !narrow}>
              <Download className="mr-1 h-4 w-4" /> Export JSON
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={readOnly}>
              <Upload className="mr-1 h-4 w-4" /> Import JSON
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ""
                if (f) void doImport(f)
              }}
            />
            <Button variant="outline" size="sm" onClick={() => void discard()} disabled={readOnly || !overview.draft}>
              <RotateCcw className="mr-1 h-4 w-4" /> Discard draft
            </Button>
          </div>
        </div>
      </header>

      {!hasPublished && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertDescription>No delivery zones published. This restaurant can&apos;t take delivery orders.</AlertDescription>
        </Alert>
      )}
      {saveStatus === "conflict" && (
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertDescription className="flex items-center justify-between gap-3">
            This draft was changed in another window. Reload to see the latest version.
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert className="rounded-none border-x-0 border-t-0">
          <AlertDescription className="flex items-center justify-between gap-3">
            {notice}
            <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {viewing && (
        <Alert className="rounded-none border-x-0 border-t-0">
          <AlertDescription className="flex items-center justify-between gap-3">
            Viewing version {viewing.version} (read-only).
            <Button size="sm" variant="outline" onClick={() => setViewing(null)}>
              Back to the draft
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {narrow ? (
        <div className="flex flex-1 flex-col gap-3 p-4">
          <Alert>
            <AlertDescription>Editing zones needs a larger screen.</AlertDescription>
          </Alert>
          <div className="h-[70vh]">
            <ZoneMap
              {...mapCommon()}
            />
          </div>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_420px]">
          <div className="relative p-3">
            <ZoneMap {...mapCommon()} />
            {popover && step === "pieces" && !readOnly && (
              <PiecePopover
                popover={popover}
                state={state}
                pieces={computed.pieces}
                onClose={() => setPopover(null)}
                edit={edit}
              />
            )}
          </div>
          <aside className="flex max-h-[calc(100vh-64px)] flex-col border-l">
            <nav className="flex flex-wrap gap-1 border-b p-2">
              {STEPS.map((s) => (
                <Button
                  key={s.id}
                  size="sm"
                  variant={step === s.id ? "default" : "ghost"}
                  onClick={() => {
                    setStep(s.id)
                    setDrawing(false)
                    setPopover(null)
                    if (s.id !== "publish") setLayers("draft")
                  }}
                >
                  {s.label}
                  {s.id === "publish" && blockers.length > 0 && (
                    <Badge variant="destructive" className="ml-1 h-4 px-1 text-[10px]">
                      {blockers.length}
                    </Badge>
                  )}
                </Button>
              ))}
            </nav>
            <div className="flex-1 overflow-y-auto p-4">
              {step === "center" && (
                <CenterStep
                  origin={state.origin}
                  liveOrigin={published?.origin ?? null}
                  outerM={outerM}
                  readOnly={readOnly}
                  onPick={(p) => moveOrigin(p)}
                />
              )}
              {step === "rings" && <RingsStep rings={state.rings} readOnly={readOnly} edit={edit} onShow={showOnMap} />}
              {step === "cut" && (
                <CutStep
                  lines={state.cut_lines}
                  drawing={drawing}
                  selectedLineId={selectedLineId}
                  readOnly={readOnly}
                  issues={computed.issues}
                  onDrawing={setDrawing}
                  onSelect={setSelectedLineId}
                  edit={edit}
                />
              )}
              {step === "pieces" && (
                <PiecesStep
                  pieces={computed.pieces}
                  hover={hoverPiece}
                  onHover={setHighlightPiece}
                  onShow={showOnMap}
                />
              )}
              {step === "test" && (
                <TestStep
                  tests={tests}
                  bias={state.origin ? { center: state.origin, radiusM: outerM + 2000 } : null}
                />
              )}
              {step === "publish" && (
                <PublishStep
                  businessId={businessId}
                  draftVersion={draftVersion}
                  computed={computed}
                  state={state}
                  published={published}
                  layers={layers}
                  saving={saveStatus === "pending" || saveStatus === "saving"}
                  saveBlocked={saveBlocked}
                  readOnly={readOnly}
                  revision={() => revisionRef.current}
                  onLayers={setLayers}
                  onShow={showOnMap}
                  onIssues={(issues) => setComputed((c) => ({ ...c, issues }))}
                  onConflict={() => setSaveStatus("conflict")}
                  onPublished={async (v) => {
                    await load()
                    setLayers("draft")
                    setNotice(`Version ${v} is live.`)
                  }}
                />
              )}
              {step === "history" && (
                <HistoryStep
                  businessId={businessId}
                  versions={overview.versions}
                  viewingVersion={viewing?.version ?? null}
                  readOnly={narrow || saveStatus === "conflict"}
                  revision={() => revisionRef.current}
                  onView={setViewing}
                  onRestored={(draft, v) => {
                    setViewing(null)
                    applyDraft(draft, null)
                    setOverview((o) => (o ? { ...o, draft } : o))
                    setNotice(`Version ${v} copied into the draft. Review it, then publish it as a new version.`)
                  }}
                  onConflict={() => setSaveStatus("conflict")}
                />
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )

  function mapCommon() {
    return {
      origin: viewing ? viewing.origin : state.origin,
      rings: viewing ? viewing.rings.map((r) => ({ key: r.id, radiusM: r.radius_m })) : ringsForMap,
      cutLines: viewing ? viewing.cut_lines : state.cut_lines,
      extendedLines: viewing ? viewing.extended_lines : computed.extended_lines,
      pieces: mapPieces,
      livePieces: step === "publish" ? (published?.pieces ?? null) : null,
      layers,
      rules: viewing ? viewing.rules : state.rules,
      step,
      readOnly,
      drawing,
      selectedLineId,
      highlightPieceId: highlightPiece ?? hoverPiece ?? tests.current?.draft?.zone_id ?? null,
      testPoint: step === "test" ? (tests.current?.point ?? null) : null,
      focus,
      resyncNonce,
      onOriginChange: moveOrigin,
      onRingRadiusChange,
      onLinesChange,
      onDrawFinished: () => setDrawing(false),
      onSelectLine: setSelectedLineId,
      onPieceClick: (pieceId: string, at: LatLng, pixel: { x: number; y: number }) => setPopover({ pieceId, at, pixel }),
      onPieceHover: setHoverPiece,
      onMapClick: (at: LatLng) => void tests.run(at, null),
      onRuleMove: (id: string, at: LatLng) => edit((s) => ({ ...s, rules: s.rules.map((u) => (u.id === id ? { ...u, anchor: at } : u)) })),
    }
  }
}

function SaveIndicator({ status, blocked, onRetry }: { status: AutosaveStatus; blocked: string | null; onRetry: () => void }) {
  if (blocked) return <span className="text-xs text-amber-700">{blocked}</span>
  switch (status) {
    case "pending":
    case "saving":
      return (
        <span className="flex items-center text-xs text-muted-foreground">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Saving…
        </span>
      )
    case "saved":
      return <span className="text-xs text-muted-foreground">Saved</span>
    case "error":
      return (
        <span className="flex items-center gap-1 text-xs text-destructive">
          Error,
          <button type="button" className="underline" onClick={onRetry}>
            retry
          </button>
        </span>
      )
    case "conflict":
      return <span className="text-xs text-destructive">Not saved: changed in another window</span>
    default:
      return null
  }
}
