import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/superadmin-auth", () => ({ lookupOperator: vi.fn() }))
vi.mock("@/lib/supabase-server", () => ({ getSupabaseClient: vi.fn() }))
vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("ADMIN_CLIENT_REACHED")
  }),
}))

import { lookupOperator } from "@/lib/superadmin-auth"
import { getSupabaseClient } from "@/lib/supabase-server"
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
  vi.mocked(lookupOperator).mockResolvedValue({ status: "operator", admin: { userId: "u1", email: null } })
  vi.mocked(getSupabaseClient).mockResolvedValue({
    auth: { getSession: async () => ({ data: { session: { access_token: "operator-jwt" } } }) },
  } as never)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("POST /api/businesses/payout-account", () => {
  it("refuses a bad business id before calling anything", async () => {
    const res = await POST(req({ business_id: "nope" }))
    expect(res.status).toBe(400)
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
