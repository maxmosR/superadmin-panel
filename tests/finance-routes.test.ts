import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/superadmin-auth", () => ({ lookupOperator: vi.fn() }))
vi.mock("@/lib/supabase-server", () => ({ getSupabaseClient: vi.fn() }))
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }))

import { lookupOperator } from "@/lib/superadmin-auth"
import { getSupabaseClient } from "@/lib/supabase-server"
import { createAdminClient } from "@/lib/supabase-admin"
import * as overview from "@/app/api/finance/overview/route"
import * as settlements from "@/app/api/finance/settlements/route"
import * as commission from "@/app/api/businesses/commission/route"
import * as statement from "@/app/api/finance/settlements/statement/route"

const BIZ = "00000000-0000-4000-8000-000000000001"
const SID = "00000000-0000-4000-8000-000000000009"
const OP = "00000000-0000-4000-8000-0000000000aa"

const json = (method: string, url: string, body: unknown) =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

type RpcResult = { data: unknown; error: { message: string; code?: string } | null }
const rpc = vi.fn<(name: string, args: Record<string, unknown>) => Promise<RpcResult>>()
const fetchMock = vi.fn()

beforeEach(() => {
  rpc.mockReset()
  fetchMock.mockReset()
  vi.mocked(createAdminClient).mockReset()
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as never)
  vi.mocked(lookupOperator).mockResolvedValue({ status: "operator", admin: { userId: OP, email: null } })
  vi.mocked(getSupabaseClient).mockResolvedValue({
    auth: { getSession: async () => ({ data: { session: { access_token: "operator-jwt" } } }) },
  } as never)
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon")
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("GET /api/finance/overview", () => {
  const get = (qs: string) => overview.GET(new Request(`http://localhost/api/finance/overview?${qs}`))

  it.each([
    ["from=2026-11-01", "invalid_date"],
    ["from=2026-11-31&to=2026-12-01", "invalid_date"],
    ["from=2026-12-02&to=2026-12-01", "invalid_range"],
    ["from=2025-01-01&to=2026-01-02", "invalid_range"],
  ])("refuses %s before the service-role client", async (qs, code) => {
    const res = await get(qs)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: code })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("calls operator_finance_overview with Rome midnights and the cap month, normalising bigints", async () => {
    rpc.mockResolvedValue({ data: [{ business_id: BIZ, business_name: "Hosuto", slug: "hosuto", fee_cents: "675", net_cents: "-200", monthly_cap_cents: null }], error: null })
    const res = await get("from=2026-10-01&to=2026-10-31")
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith("operator_finance_overview", {
      p_from: "2026-09-30T22:00:00.000Z",
      p_to: "2026-10-31T23:00:00.000Z",
      p_cap_month: "2026-10-01",
    })
    const body = await res.json()
    expect(body.cap_month).toBe("2026-10-01")
    expect(body.businesses[0]).toMatchObject({ fee_cents: 675, net_cents: -200, monthly_cap_cents: null })
  })
})

describe("GET /api/finance/settlements", () => {
  it("refuses an unknown status or a malformed business id", async () => {
    let res = await settlements.GET(new Request("http://localhost/api/finance/settlements?status=done"))
    expect(res.status).toBe(400)
    res = await settlements.GET(new Request("http://localhost/api/finance/settlements?business_id=nope"))
    expect(res.status).toBe(400)
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("lists newest first with restaurant names", async () => {
    const calls: Array<[string, ...unknown[]]> = []
    const settlementsQuery = {
      select: (...a: unknown[]) => (calls.push(["select", ...a]), settlementsQuery),
      eq: (...a: unknown[]) => (calls.push(["eq", ...a]), settlementsQuery),
      order: (...a: unknown[]) => (calls.push(["order", ...a]), settlementsQuery),
      limit: async (n: number) => (calls.push(["limit", n]), { data: [{ id: SID, business_id: BIZ, status: "pending_approval", payout_cents: "1500", version: 2 }], error: null }),
    }
    const bizQuery = {
      select: () => bizQuery,
      in: async () => ({ data: [{ business_id: BIZ, business_name: "Hosuto", slug: "hosuto" }], error: null }),
    }
    vi.mocked(createAdminClient).mockReturnValue({ from: (table: string) => (table === "settlements" ? settlementsQuery : bizQuery) } as never)
    const res = await settlements.GET(new Request(`http://localhost/api/finance/settlements?status=pending_approval&business_id=${BIZ}`))
    expect(res.status).toBe(200)
    expect(calls).toContainEqual(["eq", "status", "pending_approval"])
    expect(calls).toContainEqual(["eq", "business_id", BIZ])
    expect(calls).toContainEqual(["order", "period_start", { ascending: false }])
    expect(calls).toContainEqual(["limit", 200])
    const body = await res.json()
    expect(body.settlements[0]).toMatchObject({ id: SID, business_name: "Hosuto", payout_cents: 1500, version: 2 })
  })
})

describe("POST /api/finance/settlements", () => {
  const post = (body: unknown) => settlements.POST(json("POST", "http://localhost/api/finance/settlements", body))

  it.each([
    [{ action: "approve", settlement_id: SID, expected_version: 1 }],
    [{ action: "pay", settlement_id: "nope", expected_version: 1 }],
    [{ action: "pay", settlement_id: SID, expected_version: 0 }],
    [{ action: "pay", settlement_id: SID, expected_version: 1.5 }],
    [{ action: "pay", settlement_id: SID, expected_version: "1" }],
  ])("refuses %j", async (body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("requires a cancel reason", async () => {
    const res = await post({ action: "cancel", settlement_id: SID, expected_version: 1, reason: "  " })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "invalid_reason" })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("pay forwards to operator-settlement-pay with the operator's own token, no service-role client", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ settlement: { id: SID, status: "processing", version: "3" } }), { status: 200 }))
    const res = await post({ action: "pay", settlement_id: SID, expected_version: 2 })
    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://proj.supabase.co/functions/v1/operator-settlement-pay")
    expect(init.headers.Authorization).toBe("Bearer operator-jwt")
    expect(JSON.parse(init.body)).toEqual({ settlement_id: SID, expected_version: 2 })
    expect((await res.json()).settlement).toMatchObject({ status: "processing", version: 3 })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("passes the Edge Function's errors through", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "insufficient_available_balance", available_cents: 4200 }), { status: 409 }))
    const res = await post({ action: "pay", settlement_id: SID, expected_version: 2 })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "insufficient_available_balance", available_cents: 4200 })
  })

  it("answers 503 when the function can't be reached", async () => {
    fetchMock.mockRejectedValue(new Error("network"))
    const res = await post({ action: "pay", settlement_id: SID, expected_version: 2 })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "payment_gateway_unavailable" })
  })

  it("cancel calls settlement_cancel as the operator", async () => {
    rpc.mockResolvedValue({ data: { id: SID, status: "cancelled", version: 2 }, error: null })
    const res = await post({ action: "cancel", settlement_id: SID, expected_version: 1, reason: " wrong rate " })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith("settlement_cancel", { p_id: SID, p_expected_version: 1, p_actor_id: OP, p_reason: "wrong rate" })
  })

  it.each([
    ["not_found", 404, "not_found"],
    ["version_conflict", 409, "version_conflict"],
    ["invalid_transition", 409, "invalid_transition"],
    ["not_latest", 409, "not_latest"],
    ["forbidden", 403, "not_operator"],
  ])("maps %s to %i", async (message, status, code) => {
    rpc.mockResolvedValue({ data: null, error: { message, code: "P0001" } })
    const res = await post({ action: "cancel", settlement_id: SID, expected_version: 1, reason: "x" })
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: code })
  })
})

describe("/api/businesses/commission", () => {
  const put = (body: unknown) => commission.PUT(json("PUT", "http://localhost/api/businesses/commission", body))

  it.each([
    [{ business_id: "nope", rate_percent: 15, monthly_cap_eur: null }, "invalid_business_id"],
    [{ business_id: BIZ, rate_percent: "15", monthly_cap_eur: null }, "invalid_rate"],
    [{ business_id: BIZ, rate_percent: 100.5, monthly_cap_eur: null }, "invalid_rate"],
    [{ business_id: BIZ, rate_percent: 15.123, monthly_cap_eur: null }, "invalid_rate"],
    [{ business_id: BIZ, rate_percent: -1, monthly_cap_eur: null }, "invalid_rate"],
    [{ business_id: BIZ, rate_percent: 15, monthly_cap_eur: -1 }, "invalid_cap"],
    [{ business_id: BIZ, rate_percent: 15, monthly_cap_eur: 10.001 }, "invalid_cap"],
    [{ business_id: BIZ, rate_percent: 15, monthly_cap_eur: "250" }, "invalid_cap"],
  ])("refuses %j", async (body, code) => {
    const res = await put(body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: code })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("converts to integer bps / cents and calls set_commission_settings as the operator", async () => {
    rpc.mockResolvedValue({ data: { business_id: BIZ, rate_bps: 1255, monthly_cap_cents: "25029", updated_at: "2026-11-23T10:00:00Z" }, error: null })
    const res = await put({ business_id: BIZ, rate_percent: 12.55, monthly_cap_eur: 250.29 })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith("set_commission_settings", {
      p_business_id: BIZ,
      p_actor_id: OP,
      p_rate_bps: 1255,
      p_monthly_cap_cents: 25029,
    })
    expect(await res.json()).toEqual({ business_id: BIZ, rate_bps: 1255, monthly_cap_cents: 25029, updated_at: "2026-11-23T10:00:00Z" })
  })

  it("an empty cap means no cap", async () => {
    rpc.mockResolvedValue({ data: { business_id: BIZ, rate_bps: 1500, monthly_cap_cents: null, updated_at: null }, error: null })
    await put({ business_id: BIZ, rate_percent: 15, monthly_cap_eur: null })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_rate_bps: 1500, p_monthly_cap_cents: null })
  })

  it.each([
    ["not_found", 404, "business_not_found"],
    ["invalid_payload", 400, "invalid_payload"],
    ["forbidden", 403, "not_operator"],
  ])("maps %s to %i", async (message, status, code) => {
    rpc.mockResolvedValue({ data: null, error: { message, code: "P0001" } })
    const res = await put({ business_id: BIZ, rate_percent: 15, monthly_cap_eur: null })
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: code })
  })

  it("GET refuses a malformed id and reads 0 % / no cap when there is no row", async () => {
    let res = await commission.GET(new Request("http://localhost/api/businesses/commission?business_id=nope"))
    expect(res.status).toBe(400)
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) }
    vi.mocked(createAdminClient).mockReturnValue({ from: () => q } as never)
    res = await commission.GET(new Request(`http://localhost/api/businesses/commission?business_id=${BIZ}`))
    expect(await res.json()).toEqual({ business_id: BIZ, rate_bps: 0, monthly_cap_cents: null, updated_at: null })
  })
})

describe("GET /api/finance/settlements/statement", () => {
  it("refuses a malformed id before the service-role client", async () => {
    const res = await statement.GET(new Request("http://localhost/api/finance/settlements/statement?id=nope"))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "invalid_id" })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("answers 404 when settlement_statement returns null", async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const res = await statement.GET(new Request(`http://localhost/api/finance/settlements/statement?id=${SID}`))
    expect(res.status).toBe(404)
    expect(rpc).toHaveBeenCalledWith("settlement_statement", { p_id: SID })
  })

  it("returns the normalised statement", async () => {
    rpc.mockResolvedValue({
      data: {
        settlement: { id: SID, business_id: BIZ, status: "paid", payout_cents: "1500", vat_cents: "66" },
        business: { business_id: BIZ, name: "Hosuto", tax_id: null, slug: "hosuto" },
        settings: { rate_bps: 1500, monthly_cap_cents: null },
        month: { fee_cents: "300", cap_reached_at: null },
        lines: [{ order_number: 7, kind: "fee", method: "card", amount_cents: "2000", fee_cents: "300", full_fee_cents: "300" }],
      },
      error: null,
    })
    const res = await statement.GET(new Request(`http://localhost/api/finance/settlements/statement?id=${SID}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.settlement).toMatchObject({ payout_cents: 1500, vat_cents: 66, business_name: "Hosuto" })
    expect(body.lines[0]).toMatchObject({ order_number: "7", amount_cents: 2000 })
  })
})
