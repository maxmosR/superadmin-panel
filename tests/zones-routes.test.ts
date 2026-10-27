import { beforeEach, describe, expect, it, vi } from "vitest"

// The zone routes: right RPC with the right arguments, SQL errors mapped to
// HTTP, and invalid bodies refused before any RPC.
const state = vi.hoisted(() => ({
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResults: {} as Record<string, { data: unknown; error: unknown }>,
  tables: {} as Record<string, unknown[]>,
}))

vi.mock("@/lib/superadmin-auth", () => ({
  lookupOperator: vi.fn(async () => ({ status: "operator", admin: { userId: "op-user-1", email: "op@x" } })),
}))
vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: () => {
    const chain = (rows: unknown[]) => {
      const b: Record<string, unknown> = {}
      for (const m of ["select", "eq", "in", "order"]) b[m] = () => b
      b.maybeSingle = async () => ({ data: rows[0] ?? null, error: null })
      b.then = (ok: (v: unknown) => unknown) => ok({ data: rows, error: null })
      return b
    }
    return {
      from: (t: string) => chain(state.tables[t] ?? []),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        state.rpc.push({ fn, args })
        return state.rpcResults[fn] ?? { data: null, error: null }
      },
    }
  },
}))

import * as zones from "@/app/api/zones/route"
import * as draft from "@/app/api/zones/draft/route"
import * as discard from "@/app/api/zones/draft/discard/route"
import * as test from "@/app/api/zones/test/route"
import * as publish from "@/app/api/zones/publish/route"
import * as restore from "@/app/api/zones/restore/route"
import * as version from "@/app/api/zones/version/route"

const BIZ = "00000000-0000-4000-8000-000000000001"
const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
const PAYLOAD = {
  origin: { lat: 44.4056, lng: 8.9463 },
  rings: [{ radius_m: 1500, fee: 2, min_order: 0, label: null }, { radius_m: 2500, fee: 4, min_order: 20, label: "outer" }],
  cut_lines: [{ id: null, label: "river", points: [{ lat: 44.4, lng: 8.95 }, { lat: 44.41, lng: 8.95 }] }],
  rules: [{ id: null, anchor: { lat: 44.405, lng: 8.96 }, mode: "custom_fee", fee: 5, label: null }],
}
const sqlError = (message: string, details: string | null = null, code = "P0001") => ({ data: null, error: { message, details, code } })

beforeEach(() => {
  state.rpc = []
  state.rpcResults = {}
  state.tables = {}
})

describe("happy paths", () => {
  it("PUT /api/zones/draft saves the payload with the expected revision", async () => {
    state.rpcResults.save_delivery_zone_draft = { data: { revision: 4, pieces: { type: "FeatureCollection", features: [] }, issues: [] }, error: null }
    const res = await draft.PUT(json({ business_id: BIZ, expected_revision: 3, ...PAYLOAD }, "PUT"))
    expect(res.status).toBe(200)
    expect((await res.json()).revision).toBe(4)
    expect(state.rpc).toEqual([
      { fn: "save_delivery_zone_draft", args: { p_business_id: BIZ, p_expected_revision: 3, p_payload: PAYLOAD } },
    ])
  })

  it("POST /api/zones/publish passes the guard's user id, never the body's", async () => {
    state.rpcResults.publish_delivery_zone_set = { data: { published_version: 2, published_set_id: "s", new_draft_revision: 5 }, error: null }
    const res = await publish.POST(
      json({ business_id: BIZ, expected_revision: 4, acknowledge_warnings: true, operator_id: "attacker", p_operator_id: "attacker" }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ published_version: 2, published_set_id: "s", new_draft_revision: 5 })
    expect(state.rpc[0]).toEqual({
      fn: "publish_delivery_zone_set",
      args: { p_business_id: BIZ, p_expected_revision: 4, p_acknowledge_warnings: true, p_operator_id: "op-user-1" },
    })
  })

  it("POST /api/zones/test asks the same core for the draft and the live version", async () => {
    state.rpcResults.test_delivery_address = { data: [{ status: "ok", fee: 4 }], error: null }
    const res = await test.POST(json({ business_id: BIZ, lat: 44.41, lng: 8.95 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ draft: { status: "ok", fee: 4 }, published: { status: "ok", fee: 4 } })
    expect(state.rpc.map((c) => c.args.p_target).sort()).toEqual(["draft", "published"])
    expect(state.rpc[0].args).toMatchObject({ p_business_id: BIZ, p_lat: 44.41, p_lng: 8.95 })
  })

  it("POST /api/zones/draft/discard and /restore return the new draft", async () => {
    state.rpcResults.discard_delivery_zone_draft = { data: { version: 3 }, error: null }
    let res = await discard.POST(json({ business_id: BIZ, expected_revision: 2 }))
    expect(await res.json()).toEqual({ draft: { version: 3 } })
    expect(state.rpc[0]).toEqual({ fn: "discard_delivery_zone_draft", args: { p_business_id: BIZ, p_expected_revision: 2 } })

    state.rpcResults.restore_delivery_zone_version = { data: { version: 3, based_on_version: 1 }, error: null }
    res = await restore.POST(json({ business_id: BIZ, version: 1, expected_revision: 2 }))
    expect(await res.json()).toEqual({ draft: { version: 3, based_on_version: 1 } })
    expect(state.rpc[1]).toEqual({ fn: "restore_delivery_zone_version", args: { p_business_id: BIZ, p_version: 1, p_expected_revision: 2 } })
  })

  it("GET /api/zones/version reads one version", async () => {
    state.rpcResults.get_delivery_zone_set_geojson = { data: { version: 1 }, error: null }
    const res = await version.GET(new Request(`http://localhost/x?business_id=${BIZ}&version=1`))
    expect(await res.json()).toEqual({ zone_set: { version: 1 } })
    expect(state.rpc[0].args).toEqual({ p_business_id: BIZ, p_which: "1" })
  })

  it("GET /api/zones returns the business, draft, live set, history and badge", async () => {
    state.tables.businesses = [{ business_id: BIZ, business_name: "Iso", slug: "iso", address: null, latitude: null, longitude: null, deleted: false }]
    state.tables.delivery_zone_sets = [
      { business_id: BIZ, version: 2, status: "draft", based_on_version: 1, published_at: null, published_by: null, created_at: "2026-10-26T10:00:00Z", updated_at: "2026-10-26T11:00:00Z" },
      { business_id: BIZ, version: 1, status: "published", based_on_version: null, published_at: "2026-10-26T09:00:00Z", published_by: "op-user-1", created_at: "2026-10-26T08:00:00Z", updated_at: "2026-10-26T09:00:00Z" },
    ]
    state.tables.platform_admins = [{ user_id: "op-user-1", email: "op@x" }]
    state.rpcResults.get_delivery_zone_set_geojson = { data: { version: 1 }, error: null }
    const res = await zones.GET(new Request(`http://localhost/x?business_id=${BIZ}`))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.business).toEqual({ business_id: BIZ, business_name: "Iso", slug: "iso", address: null, latitude: null, longitude: null })
    expect(j.versions).toEqual([{ version: 1, status: "published", published_at: "2026-10-26T09:00:00Z", published_by: "op-user-1", published_by_email: "op@x" }])
    expect(j.zones).toEqual({ published_version: 1, has_draft_changes: true })
    expect(state.rpc.map((c) => c.args.p_which).sort()).toEqual(["draft", "published"])
  })

  it("GET /api/zones answers 404 for an unknown or deleted restaurant", async () => {
    let res = await zones.GET(new Request(`http://localhost/x?business_id=${BIZ}`))
    expect(res.status).toBe(404)
    state.tables.businesses = [{ business_id: BIZ, deleted: true }]
    res = await zones.GET(new Request(`http://localhost/x?business_id=${BIZ}`))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "business_not_found" })
    expect(state.rpc).toEqual([])
  })
})

describe("SQL errors map to HTTP", () => {
  const save = () => draft.PUT(json({ business_id: BIZ, expected_revision: 1, ...PAYLOAD }, "PUT"))

  it("draft_changed -> 409", async () => {
    state.rpcResults.save_delivery_zone_draft = sqlError("draft_changed")
    const res = await save()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "draft_changed" })
  })

  it("publish_blocked / warnings_not_acknowledged -> 422 with the issues", async () => {
    const issues = [{ severity: "blocker", code: "no_ring", message: "Add at least one ring.", ref: null }]
    for (const code of ["publish_blocked", "warnings_not_acknowledged"]) {
      state.rpcResults.publish_delivery_zone_set = sqlError(code, JSON.stringify(issues))
      const res = await publish.POST(json({ business_id: BIZ, expected_revision: 1, acknowledge_warnings: false }))
      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({ error: code, issues })
    }
  })

  it("invalid_payload -> 400 with the field", async () => {
    state.rpcResults.save_delivery_zone_draft = sqlError("invalid_payload", "rings[0].fee", "22023")
    const res = await save()
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "invalid_payload", field: "rings[0].fee" })
  })

  it("not_found -> 404 business_not_found", async () => {
    state.rpcResults.save_delivery_zone_draft = sqlError("not_found", null, "P0002")
    const res = await save()
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "business_not_found" })
  })

  it("anything else -> 500 internal, logged with ids and the code only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    state.rpcResults.save_delivery_zone_draft = sqlError("boom: secret details", null, "XX000")
    const res = await save()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "internal" })
    const line = JSON.parse(log.mock.calls[0][0] as string)
    expect(line).toEqual({ event: "zones_rpc_failed", fn: "save_delivery_zone_draft", business_id: BIZ, code: "XX000" })
    log.mockRestore()
  })
})

describe("invalid bodies get 400 before any RPC", () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ["save: bad business_id", () => draft.PUT(json({ business_id: "x", expected_revision: 0, ...PAYLOAD }, "PUT"))],
    ["save: no revision", () => draft.PUT(json({ business_id: BIZ, ...PAYLOAD }, "PUT"))],
    ["save: negative fee", () => draft.PUT(json({ business_id: BIZ, expected_revision: 0, ...PAYLOAD, rings: [{ radius_m: 1500, fee: -1 }] }, "PUT"))],
    ["save: 3 decimals", () => draft.PUT(json({ business_id: BIZ, expected_revision: 0, ...PAYLOAD, rings: [{ radius_m: 1500, fee: 2.005 }] }, "PUT"))],
    ["save: bad minimum order", () => draft.PUT(json({ business_id: BIZ, expected_revision: 0, ...PAYLOAD, rings: [{ radius_m: 1500, fee: 2, min_order: -5 }] }, "PUT"))],
    ["save: duplicate radius", () => draft.PUT(json({ business_id: BIZ, expected_revision: 0, ...PAYLOAD, rings: [{ radius_m: 1500, fee: 2 }, { radius_m: 1500, fee: 3 }] }, "PUT"))],
    ["save: lat out of range", () => draft.PUT(json({ business_id: BIZ, expected_revision: 0, ...PAYLOAD, origin: { lat: 95, lng: 8 } }, "PUT"))],
    ["save: one-point line", () => draft.PUT(json({ business_id: BIZ, expected_revision: 0, ...PAYLOAD, cut_lines: [{ id: null, label: null, points: [{ lat: 44, lng: 8 }] }] }, "PUT"))],
    ["save: custom fee without fee", () => draft.PUT(json({ business_id: BIZ, expected_revision: 0, ...PAYLOAD, rules: [{ id: null, anchor: { lat: 44, lng: 8 }, mode: "custom_fee", fee: null, label: null }] }, "PUT"))],
    ["save: not JSON", () => draft.PUT(new Request("http://localhost/x", { method: "PUT", body: "{" }))],
    ["publish: missing acknowledge", () => publish.POST(json({ business_id: BIZ, expected_revision: 1 }))],
    ["test: no coordinates", () => test.POST(json({ business_id: BIZ }))],
    ["restore: version 0", () => restore.POST(json({ business_id: BIZ, version: 0, expected_revision: 1 }))],
    ["discard: revision -1", () => discard.POST(json({ business_id: BIZ, expected_revision: -1 }))],
    ["version: bad version", () => version.GET(new Request(`http://localhost/x?business_id=${BIZ}&version=x`))],
    ["overview: bad id", () => zones.GET(new Request("http://localhost/x?business_id=nope"))],
  ]
  it.each(cases)("%s", async (_name, call) => {
    const res = await call()
    expect(res.status).toBe(400)
    expect(state.rpc).toEqual([])
  })
})
