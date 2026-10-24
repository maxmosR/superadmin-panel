import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state: {
  user: { id: string; email?: string } | null
  userError: { name: string; code?: string; message: string } | null
  row: { user_id: string; email: string | null; is_active: boolean } | null
  error: { code: string; message: string } | null
  eqCalls: Array<[string, unknown]>
  table: string | null
} = { user: null, userError: null, row: null, error: null, eqCalls: [], table: null }

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseClient: vi.fn(async () => {
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        state.eqCalls.push([column, value])
        return query
      },
      maybeSingle: async () => ({ data: state.row, error: state.error }),
    }
    return {
      auth: { getUser: async () => ({ data: { user: state.user }, error: state.userError }) },
      from: (table: string) => {
        state.table = table
        return query
      },
    }
  }),
}))

import { getPlatformAdmin, lookupOperator } from "@/lib/superadmin-auth"

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  state.user = null
  state.userError = null
  state.row = null
  state.error = null
  state.eqCalls = []
  state.table = null
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe("lookupOperator", () => {
  it("is unauthenticated without a session, and does not log the normal no-session case", async () => {
    state.userError = { name: "AuthSessionMissingError", message: "Auth session missing!" }
    expect(await lookupOperator()).toEqual({ status: "unauthenticated" })
    expect(await getPlatformAdmin()).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it("stays unauthenticated on a getUser error and logs only code/message", async () => {
    state.userError = { name: "AuthApiError", code: "bad_jwt", message: "invalid JWT" }
    expect(await lookupOperator()).toEqual({ status: "unauthenticated" })
    expect(consoleError).toHaveBeenCalledWith("[superadmin] getUser failed", "bad_jwt", "invalid JWT")
  })

  it("filters platform_admins on user_id = caller and is_active = true", async () => {
    state.user = { id: "u1", email: "x@example.com" }
    await lookupOperator()
    expect(state.table).toBe("platform_admins")
    expect(state.eqCalls).toEqual(expect.arrayContaining([["user_id", "u1"], ["is_active", true]]))
    expect(state.eqCalls).toHaveLength(2)
  })

  it("is not_operator for a user with no active platform_admins row", async () => {
    state.user = { id: "u1", email: "x@example.com" }
    expect(await lookupOperator()).toEqual({ status: "not_operator" })
    expect(await getPlatformAdmin()).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it("fails closed (not_operator) when the membership lookup errors, logging code/message only", async () => {
    state.user = { id: "u1", email: "x@example.com" }
    state.error = { code: "42501", message: "permission denied" }
    expect(await lookupOperator()).toEqual({ status: "not_operator" })
    expect(consoleError).toHaveBeenCalledWith(
      "[superadmin] platform_admins lookup failed",
      "42501",
      "permission denied",
    )
    const logged = JSON.stringify(consoleError.mock.calls)
    expect(logged).not.toContain("u1")
    expect(logged).not.toContain("x@example.com")
  })

  it("returns the operator for an active row", async () => {
    state.user = { id: "u1", email: "op@example.com" }
    state.row = { user_id: "u1", email: null, is_active: true }
    expect(await lookupOperator()).toEqual({
      status: "operator",
      admin: { userId: "u1", email: "op@example.com" },
    })
    expect(await getPlatformAdmin()).toEqual({ userId: "u1", email: "op@example.com" })
  })
})
