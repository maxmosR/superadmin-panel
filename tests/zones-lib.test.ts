import { describe, expect, it } from "vitest"
import { parseEuro, parseKm, snapRadius } from "@/lib/zones/units"
import { createAutosave, type AutosaveStatus, type SaveOutcome } from "@/lib/zones/autosave"
import { buildPayload, exportJson, parseImportJson, ringErrors, sortRings, type EditorState } from "@/lib/zones/editor-state"
import { zoneBadges } from "@/lib/zones/badge"
import { destination, distanceM, parseLatLngText } from "@/lib/zones/geo"
import type { DraftPayload } from "@/lib/zones/types"

describe("km and € parsing", () => {
  it("parses euros with a comma or a dot", () => {
    expect(parseEuro("3,50")).toBe(3.5)
    expect(parseEuro("3.50")).toBe(3.5)
    expect(parseEuro("3")).toBe(3)
    expect(parseEuro("€ 2,5")).toBe(2.5)
    expect(parseEuro("0")).toBe(0)
  })
  it("refuses blank, 3 decimals, negatives and text", () => {
    expect(parseEuro("")).toBeNull()
    expect(parseEuro("   ")).toBeNull()
    expect(parseEuro("3,505")).toBeNull()
    expect(parseEuro("-1")).toBeNull()
    expect(parseEuro("abc")).toBeNull()
    expect(parseEuro("1000")).toBeNull()
  })
  it("parses km into metres, one decimal, 0.1–50 km", () => {
    expect(parseKm("5")).toBe(5000)
    expect(parseKm("1,5")).toBe(1500)
    expect(parseKm("0.1")).toBe(100)
    expect(parseKm("50")).toBe(50_000)
    expect(parseKm("")).toBeNull()
    expect(parseKm("0")).toBeNull()
    expect(parseKm("1.55")).toBeNull()
    expect(parseKm("51")).toBeNull()
  })
  it("snaps dragged radii to 0.1 km", () => {
    expect(snapRadius(1549)).toBe(1500)
    expect(snapRadius(1551)).toBe(1600)
    expect(snapRadius(20)).toBe(100)
  })
})

/** A fake clock for the autosave queue. */
function fakeTimers() {
  let pending: Array<{ fn: () => void; at: number }> = []
  let now = 0
  return {
    setTimer: (fn: () => void, ms: number) => {
      const t = { fn, at: now + ms }
      pending.push(t)
      return t
    },
    clearTimer: (h: unknown) => {
      pending = pending.filter((t) => t !== h)
    },
    advance(ms: number) {
      now += ms
      const due = pending.filter((t) => t.at <= now)
      pending = pending.filter((t) => t.at > now)
      due.forEach((t) => t.fn())
    },
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe("autosave queue", () => {
  it("debounces: one save, with the latest state, 800 ms after the last edit", async () => {
    const clock = fakeTimers()
    const sent: number[] = []
    const q = createAutosave<number>({ delayMs: 800, send: async (s) => (sent.push(s), "ok"), ...clock })
    q.schedule(1)
    clock.advance(500)
    q.schedule(2)
    clock.advance(500)
    q.schedule(3)
    clock.advance(799)
    expect(sent).toEqual([])
    clock.advance(1)
    await tick()
    expect(sent).toEqual([3])
    expect(q.status()).toBe("saved")
  })

  it("one save in flight; edits meanwhile send only the latest state afterwards", async () => {
    const clock = fakeTimers()
    const sent: number[] = []
    let release: (v: SaveOutcome) => void = () => {}
    const q = createAutosave<number>({
      delayMs: 800,
      send: (s) => {
        sent.push(s)
        return new Promise<SaveOutcome>((r) => (release = r))
      },
      ...clock,
    })
    q.schedule(1)
    clock.advance(800)
    expect(sent).toEqual([1])
    q.schedule(2)
    q.schedule(3)
    q.schedule(4)
    clock.advance(800)
    expect(sent).toEqual([1]) // still in flight
    release("ok")
    await tick()
    expect(sent).toEqual([1, 4])
    release("ok")
    await tick()
    expect(q.status()).toBe("saved")
    expect(q.hasPending()).toBe(false)
  })

  it("stops for good on a conflict (409)", async () => {
    const clock = fakeTimers()
    const sent: number[] = []
    const statuses: AutosaveStatus[] = []
    const q = createAutosave<number>({ delayMs: 800, send: async (s) => (sent.push(s), "conflict"), onStatus: (s) => statuses.push(s), ...clock })
    q.schedule(1)
    clock.advance(800)
    await tick()
    expect(q.status()).toBe("conflict")
    q.schedule(2)
    clock.advance(800)
    q.flush()
    q.retry()
    await tick()
    expect(sent).toEqual([1])
    expect(statuses.at(-1)).toBe("conflict")
  })

  it("keeps the state after an error; retry sends it", async () => {
    const clock = fakeTimers()
    const sent: number[] = []
    let outcome: SaveOutcome = "error"
    const q = createAutosave<number>({ delayMs: 800, send: async (s) => (sent.push(s), outcome), ...clock })
    q.schedule(7)
    clock.advance(800)
    await tick()
    expect(q.status()).toBe("error")
    expect(q.hasPending()).toBe(true)
    outcome = "ok"
    q.retry()
    await tick()
    expect(sent).toEqual([7, 7])
    expect(q.status()).toBe("saved")
  })
})

const VALID: DraftPayload = {
  origin: { lat: 44.4056, lng: 8.9463 },
  rings: [{ radius_m: 1500, fee: 2, min_order: 15, label: null }],
  cut_lines: [{ id: null, label: "river", points: [{ lat: 44.4, lng: 8.95 }, { lat: 44.41, lng: 8.95 }] }],
  rules: [{ id: null, anchor: { lat: 44.405, lng: 8.96 }, mode: "excluded", fee: null, label: null }],
}

describe("import JSON", () => {
  it("accepts an export of this editor", () => {
    const text = exportJson(VALID, { slug: "iso", exported_at: "2026-10-26T00:00:00Z" })
    const r = parseImportJson(text)
    expect(r).toEqual({ ok: true, payload: VALID })
  })
  it("accepts a bare payload", () => {
    expect(parseImportJson(JSON.stringify({ origin: VALID.origin, rings: VALID.rings })).ok).toBe(true)
  })
  it("reads files from before minimums as no minimum, refuses bad ones", () => {
    const old = parseImportJson(JSON.stringify({ origin: VALID.origin, rings: [{ radius_m: 1500, fee: 2 }] }))
    expect(old.ok && old.payload.rings[0].min_order).toBe(0)
    for (const min_order of [-1, 1.234, "15", 10_000]) {
      expect(parseImportJson(JSON.stringify({ origin: VALID.origin, rings: [{ radius_m: 1500, fee: 2, min_order }] }))).toEqual({
        ok: false,
        error: "Invalid field: rings[0].min_order",
      })
    }
  })
  it("refuses broken files with a reason", () => {
    expect(parseImportJson("{")).toEqual({ ok: false, error: "The file is not valid JSON." })
    expect(parseImportJson("[]")).toEqual({ ok: false, error: "Expected a JSON object." })
    expect(parseImportJson(JSON.stringify({ ...VALID, format: "other" }))).toMatchObject({ ok: false })
    expect(parseImportJson(JSON.stringify({ ...VALID, rings: [{ radius_m: 1500, fee: "2" }] }))).toEqual({
      ok: false,
      error: "Invalid field: rings[0].fee",
    })
    expect(parseImportJson(JSON.stringify({ ...VALID, rings: new Array(11).fill(0).map((_, i) => ({ radius_m: 1000 + i * 100, fee: 1 })) }))).toEqual({
      ok: false,
      error: "Invalid field: rings",
    })
  })
})

describe("editor state", () => {
  const state = (rings: Array<[string, string] | [string, string, string]>): EditorState => ({
    origin: { lat: 44.4, lng: 8.9 },
    rings: rings.map(([km, fee, minOrder = ""], i) => ({ key: `r${i}`, km, fee, minOrder, label: "" })),
    cut_lines: [],
    rules: [],
  })
  it("builds the payload in metres and euros, sorted by distance", () => {
    const r = buildPayload(state([["2,5", "4", "20"], ["1.5", "2,00", " "]]))
    expect(r).toEqual({
      ok: true,
      payload: {
        origin: { lat: 44.4, lng: 8.9 },
        rings: [{ radius_m: 1500, fee: 2, min_order: 0, label: null }, { radius_m: 2500, fee: 4, min_order: 20, label: null }],
        cut_lines: [],
        rules: [],
      },
    })
  })
  it("never saves a blank fee or duplicate distances", () => {
    expect(buildPayload(state([["1.5", ""]])).ok).toBe(false)
    expect(ringErrors(state([["1.5", ""]]).rings)).toEqual({ r0: { fee: "Required" } })
    expect(ringErrors(state([["1.5", "2"], ["1,5", "3"]]).rings)).toEqual({
      r0: { km: "Duplicate distance" },
      r1: { km: "Duplicate distance" },
    })
  })
  it("a blank minimum is none; a bad one blocks the save", () => {
    expect(ringErrors(state([["1.5", "2", "12,50"], ["3", "4", ""]]).rings)).toEqual({})
    expect(ringErrors(state([["1.5", "2", "abc"]]).rings)).toEqual({ r0: { minOrder: "0–9999.99, two decimals, or blank" } })
    expect(buildPayload(state([["1.5", "2", "1.234"]])).ok).toBe(false)
  })
  it("sorts rows by distance, invalid ones last", () => {
    expect(sortRings(state([["x", "1"], ["5", "6"], ["1.5", "2"]]).rings).map((r) => r.km)).toEqual(["1.5", "5", "x"])
  })
  it("needs a center point", () => {
    expect(buildPayload({ ...state([["1.5", "2"]]), origin: null })).toEqual({ ok: false, reason: "Set the center point first." })
  })
})

describe("dashboard badges", () => {
  const row = (business_id: string, status: string, version: number, based_on_version: number | null, created_at: string, updated_at = created_at) => ({
    business_id, status, version, based_on_version, created_at, updated_at,
  })
  it("live, unpublished changes, restored, not set up", () => {
    const b = zoneBadges([
      row("a", "published", 1, null, "t1"), row("a", "draft", 2, 1, "2026-01-01T00:00:00Z"),
      row("b", "published", 1, null, "t1"), row("b", "draft", 2, 1, "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"),
      row("c", "published", 3, 2, "t1"), row("c", "draft", 4, 1, "2026-01-01T00:00:00Z"),
      row("d", "draft", 1, null, "2026-01-01T00:00:00Z"),
    ])
    expect(b.get("a")).toEqual({ published_version: 1, has_draft_changes: false })
    expect(b.get("b")).toEqual({ published_version: 1, has_draft_changes: true })
    expect(b.get("c")).toEqual({ published_version: 3, has_draft_changes: true })
    expect(b.get("d")).toEqual({ published_version: null, has_draft_changes: true })
    expect(b.get("e")).toBeUndefined()
  })
})

describe("geo previews", () => {
  it("destination and distance agree", () => {
    const o = { lat: 44.4056, lng: 8.9463 }
    expect(distanceM(o, destination(o, 1500, 90))).toBeCloseTo(1500, 3)
  })
  it("reads pasted coordinates, latitude first", () => {
    expect(parseLatLngText("44.4056, 8.9463")).toEqual({ lat: 44.4056, lng: 8.9463 })
    expect(parseLatLngText("44.4056 8.9463")).toEqual({ lat: 44.4056, lng: 8.9463 })
    expect(parseLatLngText("200, 8")).toBeNull()
  })
})
