import { beforeEach, describe, expect, it, vi } from "vitest"

const ME = "00000000-0000-0000-0000-0000000000aa"
const OTHER = "00000000-0000-0000-0000-0000000000bb"

vi.mock("@/lib/require-operator", () => ({
  requireOperator: vi.fn(async () => ({ admin: { userId: ME, email: null } })),
}))

const state = {
  active: [] as Array<{ user_id: string }>,
  // What the re-check after the update reads (null = same as `active` minus the target).
  activeAfter: null as Array<{ user_id: string }> | null,
  activeReads: 0,
  updated: null as { user_id: string; is_active: boolean } | null,
  updateError: null as { code: string } | null,
  auditError: null as { code: string; message: string } | null,
  // Audit writes after this many succeed fail (null = never).
  auditOkCount: null as number | null,
  audits: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  updates: [] as Array<{ values: Record<string, unknown>; eq: [string, unknown] }>,
  order: [] as string[],
  adminClients: 0,
}

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: () => {
    state.adminClients++
    return {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        state.order.push("audit")
        state.audits.push({ fn, args })
        const failLater = state.auditOkCount !== null && state.audits.length > state.auditOkCount
        return state.auditError || failLater ? { data: null, error: state.auditError } : { data: "audit-row-1", error: null }
      },
      from: (table: string) => {
        if (table !== "platform_admins") throw new Error(`unexpected table ${table}`)
        return {
          // .select("user_id").eq("is_active", true) → active operators
          select: () => ({
            eq: async () => {
              state.activeReads++
              if (state.activeReads === 1 || state.activeAfter === null) return { data: state.active, error: null }
              return { data: state.activeAfter, error: null }
            },
          }),
          update: (values: Record<string, unknown>) => ({
            eq: (col: string, val: unknown) => {
              state.order.push("update")
              state.updates.push({ values, eq: [col, val] })
              const result = { data: state.updated, error: state.updateError }
              return {
                select: () => ({ maybeSingle: async () => result }),
                then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
              }
            },
          }),
        }
      },
    }
  },
}))

import { PATCH } from "@/app/api/operators/route"

const patch = (body: unknown) =>
  PATCH(new Request("http://localhost/api/operators", { method: "PATCH", body: JSON.stringify(body) }))

beforeEach(() => {
  state.active = [{ user_id: ME }, { user_id: OTHER }]
  state.activeAfter = null
  state.activeReads = 0
  state.updated = { user_id: OTHER, is_active: false }
  state.updateError = null
  state.auditError = null
  state.auditOkCount = null
  state.audits = []
  state.updates = []
  state.order = []
  state.adminClients = 0
})

describe("PATCH /api/operators", () => {
  it("deactivates another operator, audit first, ids only", async () => {
    const res = await patch({ user_id: OTHER, is_active: false })
    expect(res.status).toBe(200)
    expect(state.order).toEqual(["audit", "update"])
    expect(state.audits).toEqual([
      {
        fn: "record_audit",
        args: {
          p_action: "operator_deactivated",
          p_actor: ME,
          p_subject_user_id: OTHER,
          p_request_id: null,
          p_detail: { source: "superadmin-panel" },
        },
      },
    ])
    expect(state.updates).toEqual([{ values: { is_active: false }, eq: ["user_id", OTHER] }])
  })

  it("re-checks after the update and rolls back if no active operator is left (concurrent deactivations)", async () => {
    // Another operator deactivated ME between our check and our update.
    state.activeAfter = []
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await patch({ user_id: OTHER, is_active: false })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "last_operator" })
    expect(state.updates).toEqual([
      { values: { is_active: false }, eq: ["user_id", OTHER] },
      { values: { is_active: true }, eq: ["user_id", OTHER] },
    ])
    expect(state.audits.map((a) => a.args.p_action)).toEqual(["operator_deactivated", "operator_activated"])
    expect(state.audits[1].args.p_detail).toEqual({ source: "superadmin-panel", reason: "last_operator_rollback", reverts_audit: "audit-row-1" })
    err.mockRestore()
  })

  it("still rolls back when the rollback's own audit row can't be written", async () => {
    state.activeAfter = []
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    // The deactivation's audit row is written, the rollback's isn't.
    state.auditOkCount = 1
    const res = await patch({ user_id: OTHER, is_active: false })
    expect(res.status).toBe(409)
    expect(state.updates.at(-1)).toEqual({ values: { is_active: true }, eq: ["user_id", OTHER] })
    err.mockRestore()
  })

  it("keeps the deactivation when someone is still active after it", async () => {
    state.activeAfter = [{ user_id: ME }]
    const res = await patch({ user_id: OTHER, is_active: false })
    expect(res.status).toBe(200)
    expect(state.updates).toHaveLength(1)
  })

  it("audits a reactivation as operator_activated", async () => {
    state.updated = { user_id: OTHER, is_active: true }
    const res = await patch({ user_id: OTHER, is_active: true })
    expect(res.status).toBe(200)
    expect(state.audits[0].args.p_action).toBe("operator_activated")
  })

  it("refuses to deactivate yourself before any database access", async () => {
    const res = await patch({ user_id: ME.toUpperCase(), is_active: false })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "cannot_deactivate_self" })
    expect(state.adminClients).toBe(0)
    expect(state.audits).toHaveLength(0)
    expect(state.updates).toHaveLength(0)
  })

  it("still refuses the last active operator, without an audit row", async () => {
    state.active = [{ user_id: OTHER }]
    const res = await patch({ user_id: OTHER, is_active: false })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "last_operator" })
    expect(state.audits).toHaveLength(0)
    expect(state.updates).toHaveLength(0)
  })

  it("changes nothing when the audit write fails", async () => {
    state.auditError = { code: "22P02", message: "invalid input value for enum" }
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await patch({ user_id: OTHER, is_active: false })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "audit_failed" })
    expect(state.updates).toHaveLength(0)
    err.mockRestore()
  })

  it("logs the audit id when the update then fails", async () => {
    state.updateError = { code: "XX000" }
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await patch({ user_id: OTHER, is_active: false })
    expect(res.status).toBe(500)
    expect(JSON.stringify(err.mock.calls)).toContain("audit-row-1")
    err.mockRestore()
  })

  it("answers 404 for an unknown operator (the attempt stays audited)", async () => {
    state.updated = null
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await patch({ user_id: OTHER, is_active: true })
    expect(res.status).toBe(404)
    expect(state.audits).toHaveLength(1)
    err.mockRestore()
  })
})
