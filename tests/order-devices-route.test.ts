import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/require-operator", () => ({
  requireOperator: vi.fn(async () => ({ admin: { userId: "op-1", email: null } })),
}))

const state = {
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: { code: "ABCDE12345", expires_at: "2026-11-21T10:15:00Z" }, error: null } as {
    data: unknown
    error: { code: string } | null
  },
  updates: [] as Array<{ values: Record<string, unknown>; filters: Array<[string, string, unknown]> }>,
  updated: [{ id: "d1" }] as Array<{ id: string }>,
  selects: [] as string[],
}

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpc.push({ fn, args })
      return state.rpcResult
    },
    from: () => {
      const filters: Array<[string, string, unknown]> = []
      let values: Record<string, unknown> | null = null
      const q: Record<string, unknown> = {
        select: (cols: string) => {
          state.selects.push(cols)
          if (values) {
            state.updates.push({ values, filters })
            return Promise.resolve({ data: state.updated, error: null })
          }
          return q
        },
        update: (v: Record<string, unknown>) => {
          values = v
          return q
        },
        eq: (c: string, v: unknown) => {
          filters.push(["eq", c, v])
          return q
        },
        is: (c: string, v: unknown) => {
          filters.push(["is", c, v])
          return q
        },
        order: async () => ({ data: [], error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      }
      return q
    },
  }),
}))

import { GET, PATCH, POST } from "@/app/api/businesses/order-devices/route"

const BIZ = "00000000-0000-0000-0000-000000000001"
const DEV = "00000000-0000-0000-0000-000000000009"
const json = (method: string, body: unknown) =>
  new Request("http://localhost/api/businesses/order-devices", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  state.rpc = []
  state.rpcResult = { data: { code: "ABCDE12345", expires_at: "2026-11-21T10:15:00Z" }, error: null }
  state.updates = []
  state.updated = [{ id: "d1" }]
  state.selects = []
})

describe("/api/businesses/order-devices", () => {
  it("creates a pairing code through the RPC and shows it once, uncached", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const res = await POST(json("POST", { business_id: BIZ, label: " Kitchen " }))
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(await res.json()).toEqual({ code: "ABCDE-12345", expires_at: "2026-11-21T10:15:00Z" })
    expect(state.rpc).toEqual([
      { fn: "create_order_device_pairing", args: { p_business_id: BIZ, p_label: "Kitchen", p_created_by: "op-1" } },
    ])
    expect(JSON.stringify(info.mock.calls)).not.toContain("ABCDE")
    info.mockRestore()
  })

  it("refuses an over-long label", async () => {
    const res = await POST(json("POST", { business_id: BIZ, label: "x".repeat(61) }))
    expect(res.status).toBe(400)
    expect(state.rpc).toHaveLength(0)
  })

  it("answers 503 while the pairing function isn't deployed", async () => {
    state.rpcResult = { data: null, error: { code: "PGRST202" } }
    const res = await POST(json("POST", { business_id: BIZ }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "pairing_unavailable" })
  })

  it("lists devices without ever reading key_hash", async () => {
    const res = await GET(new Request(`http://localhost/api/businesses/order-devices?business_id=${BIZ}`))
    expect(res.status).toBe(200)
    expect(state.selects.join(",")).not.toContain("key_hash")
  })

  it("revokes only that restaurant's still-active device", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const res = await PATCH(json("PATCH", { business_id: BIZ, device_id: DEV }))
    expect(res.status).toBe(200)
    expect(state.updates).toHaveLength(1)
    expect(typeof state.updates[0].values.revoked_at).toBe("string")
    expect(state.updates[0].filters).toEqual(
      expect.arrayContaining([
        ["eq", "id", DEV],
        ["eq", "business_id", BIZ],
        ["is", "revoked_at", null],
      ]),
    )
  })

  it("answers 404 for a device of another restaurant", async () => {
    state.updated = []
    const res = await PATCH(json("PATCH", { business_id: BIZ, device_id: DEV }))
    expect(res.status).toBe(404)
  })
})
