import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state: {
  user: { id: string; email?: string; factors?: Array<{ factor_type: string; status: string }> } | null
  accessToken: string | null
  userError: { name: string; code?: string; message: string } | null
  row: { user_id: string; email: string | null; is_active: boolean } | null
  error: { code: string; message: string } | null
  eqCalls: Array<[string, unknown]>
  table: string | null
} = { user: null, userError: null, accessToken: null, row: null, error: null, eqCalls: [], table: null }

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
      auth: {
        getUser: async () => ({ data: { user: state.user }, error: state.userError }),
        getSession: async () => ({
          data: { session: state.accessToken ? { access_token: state.accessToken } : null },
          error: null,
        }),
      },
      from: (table: string) => {
        state.table = table
        return query
      },
    }
  }),
}))

import { lookupOperator } from "@/lib/superadmin-auth"
import { decodeJwtClaims, redirectPathFor } from "@/lib/operator-status"

/** An unsigned JWT-shaped token (lookupOperator only reads claims of a token getUser already accepted). */
function token(claims: Record<string, unknown>) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.sig`
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  state.user = null
  state.userError = null
  state.accessToken = null
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

  it("returns the operator for an active row on an AAL2 session", async () => {
    state.user = { id: "u1", email: "op@example.com" }
    state.row = { user_id: "u1", email: null, is_active: true }
    state.accessToken = token({ sub: "u1", aal: "aal2" })
    expect(await lookupOperator()).toEqual({
      status: "operator",
      admin: { userId: "u1", email: "op@example.com" },
    })
  })

  describe("MFA (AAL2) guard", () => {
    const admin = { userId: "u1", email: "op@example.com" }
    beforeEach(() => {
      state.row = { user_id: "u1", email: null, is_active: true }
    })

    it("sends an AAL1 operator with no TOTP factor to enrolment", async () => {
      state.user = { id: "u1", email: "op@example.com", factors: [] }
      state.accessToken = token({ sub: "u1", aal: "aal1" })
      const r = await lookupOperator()
      expect(r).toEqual({ status: "mfa_required", admin, hasTotp: false })
      expect(redirectPathFor(r as Exclude<typeof r, { status: "operator" }>)).toBe("/mfa/enroll")
    })

    it("treats an unverified TOTP factor as not enrolled", async () => {
      state.user = { id: "u1", factors: [{ factor_type: "totp", status: "unverified" }] }
      state.accessToken = token({ sub: "u1", aal: "aal1" })
      expect(await lookupOperator()).toMatchObject({ status: "mfa_required", hasTotp: false })
    })

    it("sends an AAL1 operator with a verified TOTP factor to the challenge", async () => {
      state.user = { id: "u1", email: "op@example.com", factors: [{ factor_type: "totp", status: "verified" }] }
      state.accessToken = token({ sub: "u1", aal: "aal1" })
      const r = await lookupOperator()
      expect(r).toEqual({ status: "mfa_required", admin, hasTotp: true })
      expect(redirectPathFor(r as Exclude<typeof r, { status: "operator" }>)).toBe("/mfa/challenge")
    })

    it("does not accept an aal2 token that belongs to someone else", async () => {
      state.user = { id: "u1", factors: [{ factor_type: "totp", status: "verified" }] }
      state.accessToken = token({ sub: "someone-else", aal: "aal2" })
      expect(await lookupOperator()).toMatchObject({ status: "mfa_required" })
    })

    it("fails closed without a session token or with a garbage one", async () => {
      state.user = { id: "u1" }
      expect(await lookupOperator()).toMatchObject({ status: "mfa_required" })
      state.accessToken = "not-a-jwt"
      expect(await lookupOperator()).toMatchObject({ status: "mfa_required" })
    })

    it("never asks a non-operator for MFA", async () => {
      state.row = null
      state.user = { id: "u1" }
      state.accessToken = token({ sub: "u1", aal: "aal1" })
      expect(await lookupOperator()).toEqual({ status: "not_operator" })
    })

    it("redirects signed-out and non-operator callers to /login", () => {
      expect(redirectPathFor({ status: "unauthenticated" })).toBe("/login")
      expect(redirectPathFor({ status: "not_operator" })).toBe("/login")
    })

    it("decodes base64url JWT claims", () => {
      expect(decodeJwtClaims(token({ sub: "u1", aal: "aal2", n: "ü?>" }))).toEqual({ sub: "u1", aal: "aal2", n: "ü?>" })
      expect(decodeJwtClaims("x")).toBeNull()
    })
  })
})
