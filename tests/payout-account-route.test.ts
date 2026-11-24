import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/superadmin-auth", () => ({ lookupOperator: vi.fn() }))
vi.mock("@/lib/supabase-server", () => ({ getSupabaseClient: vi.fn() }))
// The service-role client is only used for the audit row.
const audit = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  error: null as null | { code: string },
  order: [] as string[],
}))
vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(() => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      audit.order.push(fn)
      audit.calls.push({ fn, args })
      return audit.error ? { data: null, error: audit.error } : { data: "audit-1", error: null }
    },
    from: () => {
      throw new Error("NO_TABLE_ACCESS_EXPECTED")
    },
  })),
}))

import { lookupOperator } from "@/lib/superadmin-auth"
import { getSupabaseClient } from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import { POST } from "@/app/api/businesses/payout-account/route"

const BIZ = "00000000-0000-4000-8000-000000000001"
const req = (body: unknown) =>
  new Request("http://localhost/api/businesses/payout-account", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon")
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => {
    audit.order.push("fetch")
    return new Response(JSON.stringify({ payout_account: { stripe_account_id: "acct_1" }, created: true }), { status: 201 })
  })
  audit.calls = []
  audit.error = null
  audit.order = []
  vi.mocked(createAdminClient).mockClear()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.mocked(lookupOperator).mockResolvedValue({ status: "operator", admin: { userId: "u1", email: null } })
  vi.mocked(getSupabaseClient).mockResolvedValue({
    auth: { getSession: async () => ({ data: { session: { access_token: "operator-jwt" } } }) },
  } as never)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("POST /api/businesses/payout-account", () => {
  it("refuses a bad business id before calling anything", async () => {
    const res = await POST(req({ business_id: "nope" }))
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("audits payout_account_created before calling the function", async () => {
    await POST(req({ business_id: BIZ }))
    expect(audit.order).toEqual(["record_audit", "fetch"])
    expect(audit.calls[0]).toEqual({
      fn: "record_audit",
      args: {
        p_action: "payout_account_created",
        p_actor: "u1",
        p_subject_user_id: null,
        p_request_id: null,
        p_detail: { source: "superadmin-panel", business_id: BIZ },
      },
    })
  })

  it("calls nothing when the audit write fails", async () => {
    audit.error = { code: "22P02" }
    vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await POST(req({ business_id: BIZ }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "audit_failed" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("forwards to the Edge Function with the operator's own token", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ payout_account: { stripe_account_id: "acct_1" }, created: true }), { status: 201 }))
    const res = await POST(req({ business_id: BIZ }))
    expect(res.status).toBe(201)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://proj.supabase.co/functions/v1/operator-create-payout-account")
    expect(init.headers.Authorization).toBe("Bearer operator-jwt")
    expect(JSON.parse(init.body)).toEqual({ business_id: BIZ })
  })

  it("answers 503 when the function can't be reached", async () => {
    fetchMock.mockRejectedValue(new Error("network"))
    const res = await POST(req({ business_id: BIZ }))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "payment_gateway_unavailable" })
  })
})
