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
  audits: [] as Array<Record<string, unknown>>,
  auditError: null as { code: string } | null,
  order: [] as string[],
}

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.order.push(fn)
      if (fn === "record_audit") {
        state.audits.push(args)
        return state.auditError ? { data: null, error: state.auditError } : { data: "audit-1", error: null }
      }
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
          state.order.push("update")
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
  state.audits = []
  state.auditError = null
  state.order = []
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

  it("audits a pairing first, ids only (no code, no label)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    await POST(json("POST", { business_id: BIZ, label: "Mario's tablet" }))
    expect(state.order).toEqual(["record_audit", "create_order_device_pairing"])
    expect(state.audits).toEqual([
      {
        p_action: "order_device_paired",
        p_actor: "op-1",
        p_subject_user_id: null,
        p_request_id: null,
        p_detail: { source: "superadmin-panel", business_id: BIZ, labelled: true },
      },
    ])
    expect(JSON.stringify(state.audits)).not.toMatch(/Mario|ABCDE/)
  })

  it("creates no pairing code when the audit write fails", async () => {
    state.auditError = { code: "22P02" }
    vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await POST(json("POST", { business_id: BIZ }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "audit_failed" })
    expect(state.rpc).toHaveLength(0)
  })

  it("audits a revoke first (order_device_changed with the device id)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    await PATCH(json("PATCH", { business_id: BIZ, device_id: DEV }))
    expect(state.order).toEqual(["record_audit", "update"])
    expect(state.audits[0]).toMatchObject({
      p_action: "order_device_changed",
      p_detail: { source: "superadmin-panel", business_id: BIZ, device_id: DEV, change: "revoked" },
    })
  })

  it("revokes nothing when the audit write fails", async () => {
    state.auditError = { code: "22P02" }
    vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await PATCH(json("PATCH", { business_id: BIZ, device_id: DEV }))
    expect(res.status).toBe(500)
    expect(state.updates).toHaveLength(0)
  })

  it("answers 404 for a device of another restaurant", async () => {
    state.updated = []
    const res = await PATCH(json("PATCH", { business_id: BIZ, device_id: DEV }))
    expect(res.status).toBe(404)
  })
})
