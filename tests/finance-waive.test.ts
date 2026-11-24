// POST /api/finance/commission/waive and the ledger kinds it produces.
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/superadmin-auth", () => ({ lookupOperator: vi.fn() }))
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }))

import { lookupOperator } from "@/lib/superadmin-auth"
import { createAdminClient } from "@/lib/supabase-admin"
import { POST } from "@/app/api/finance/commission/waive/route"
import {
  businessCsv,
  businessDetailTotals,
  businessOrderLine,
  isCapped,
  ledgerKind,
  normaliseStatementLine,
  payOutcome,
  statementTotals,
  type LedgerEntryRow,
} from "@/lib/finance"
import { messages } from "@/lib/i18n/messages"

const BIZ = "00000000-0000-4000-8000-000000000001"
const ORDER = "00000000-0000-4000-8000-0000000000a1"
const OP = "00000000-0000-4000-8000-0000000000aa"

type R = { data: unknown; error: { code?: string; message?: string } | null }
const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<R>>()
const feeLookup = { result: { data: { id: "e1" }, error: null } as R, filters: [] as Array<[string, unknown]> }

beforeEach(() => {
  rpc.mockReset()
  feeLookup.result = { data: { id: "e1" }, error: null }
  feeLookup.filters = []
  vi.mocked(createAdminClient).mockReset()
  vi.mocked(createAdminClient).mockReturnValue({
    rpc,
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = (c: string, v: unknown) => (feeLookup.filters.push([c, v]), q)
      q.maybeSingle = async () => feeLookup.result
      return q
    },
  } as never)
  vi.mocked(lookupOperator).mockResolvedValue({ status: "operator", admin: { userId: OP, email: null } })
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/finance/commission/waive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))

describe("POST /api/finance/commission/waive", () => {
  it.each([
    [{ business_id: "nope", order_id: ORDER, reason: "x" }, "invalid_payload"],
    [{ business_id: BIZ, order_id: "nope", reason: "x" }, "invalid_order_id"],
    [{ business_id: BIZ, order_id: ORDER, reason: "   " }, "invalid_reason"],
    [{ business_id: BIZ, order_id: ORDER }, "invalid_reason"],
    [{ business_id: BIZ, order_id: ORDER, reason: "x".repeat(501) }, "invalid_reason"],
  ])("refuses %j before the service-role client", async (body, code) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: code })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("calls waive_commission as this operator and writes no audit row of its own", async () => {
    rpc.mockResolvedValue({
      data: { result: "applied", entry_id: "w1", order_id: ORDER, fee_cents_waived: "250", cap_adjusted_cents: 100 },
      error: null,
    })
    const res = await post({ business_id: BIZ, order_id: ORDER, reason: "  rider not paid  " })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: "applied", entry_id: "w1", order_id: ORDER, fee_cents_waived: 250, cap_adjusted_cents: 100 })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith("waive_commission", { p_order_id: ORDER, p_actor_id: OP, p_reason: "rider not paid" })
    // The order's fee was checked against this restaurant.
    expect(feeLookup.filters).toEqual(expect.arrayContaining([["order_id", ORDER], ["business_id", BIZ], ["kind", "fee"]]))
    // The reason is never logged.
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("rider")
  })

  it("passes a noop through", async () => {
    rpc.mockResolvedValue({ data: { result: "noop", entry_id: "w1", order_id: ORDER, fee_cents_waived: 250, cap_adjusted_cents: 0 }, error: null })
    expect((await (await post({ business_id: BIZ, order_id: ORDER, reason: "again" })).json()).result).toBe("noop")
  })

  it("404 when the order has no fee at this restaurant, without calling the RPC", async () => {
    feeLookup.result = { data: null, error: null }
    const res = await post({ business_id: BIZ, order_id: ORDER, reason: "x" })
    expect(res.status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ["forbidden", 403, "not_operator"],
    ["invalid_payload", 400, "invalid_payload"],
    ["not_found", 404, "not_found"],
    ["invalid_transition", 409, "invalid_transition"],
  ])("maps %s to %i", async (message, status, code) => {
    rpc.mockResolvedValue({ data: null, error: { message, code: "P0001" } })
    const res = await post({ business_id: BIZ, order_id: ORDER, reason: "x" })
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual({ error: code })
  })

  it("answers stable codes for other errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "secret internals", code: "XX000" } })
    let res = await post({ business_id: BIZ, order_id: ORDER, reason: "x" })
    expect(await res.json()).toEqual({ error: "save_failed" })
    rpc.mockResolvedValue({ data: null, error: { message: "missing", code: "PGRST202" } })
    res = await post({ business_id: BIZ, order_id: ORDER, reason: "x" })
    expect(res.status).toBe(503)
  })
})

describe("ledger kinds", () => {
  const row = (over: Partial<LedgerEntryRow>): LedgerEntryRow => ({
    id: "e",
    order_id: ORDER,
    kind: "fee",
    method: "cash",
    occurred_at: "2026-11-24T10:00:00Z",
    amount_cents: 3000,
    base_cents: 2500,
    card_cents: 0,
    rate_bps: 1000,
    full_fee_cents: 250,
    fee_cents: 250,
    ...over,
  })

  it("knows the four kinds", () => {
    expect(["fee", "reversal", "waiver", "cap_adjustment", "other"].map(ledgerKind)).toEqual(["fee", "reversal", "waiver", "cap_adjustment", "fee"])
  })

  it("counts only fee lines as orders and nets waivers and adjustments into the totals", () => {
    const fee = businessOrderLine(row({ id: "e1" }), "1", null, true)
    const waiver = businessOrderLine(row({ id: "e2", kind: "waiver", amount_cents: -3000, base_cents: -2500, full_fee_cents: -250, fee_cents: -250 }), "1", null)
    const capped = businessOrderLine(row({ id: "e3", method: "card", amount_cents: 2000, base_cents: 2000, card_cents: 2000, full_fee_cents: 200, fee_cents: 50 }), "2", 30)
    const adj = businessOrderLine(row({ id: "e4", method: "card", kind: "cap_adjustment", amount_cents: 0, base_cents: 0, card_cents: 0, full_fee_cents: 0, fee_cents: 100 }), "2", 30)
    const t = businessDetailTotals([fee, waiver, capped, adj])
    expect(t).toMatchObject({ orders_count: 2, cash_orders: 1, card_orders: 1, cash_cents: 0, card_cents: 2000, gross_cents: 2000, fee_cents: 150, stripe_fee_cents: 30 })
    // Only the card order's money: 2000 − 150 commission − 30 Stripe − IVA(150) = 33.
    expect(t.net_cents).toBe(2000 - 150 - 30 - 33)
    expect(adj.stripe_fee_cents).toBe(0)
    expect(isCapped(capped)).toBe(true)
    expect(isCapped(adj)).toBe(false)
    expect(isCapped(waiver)).toBe(false)
    expect([fee.waivable, waiver.waivable, capped.waivable, adj.waivable]).toEqual([false, false, false, false])
    expect(businessOrderLine(row({}), "3", null).waivable).toBe(true)

    const b = messages.en.finance.business
    const csv = businessCsv([waiver, adj], { ...b.cols, rate: "Rate", capped: "Capped", kinds: b.kinds, methods: b.methods, yes: "yes", pending: "p", totals: "Total" })
    expect(csv).toContain(";Waived;")
    expect(csv).toContain(";Cap adjustment;")
    expect(csv.split("\r\n")[2]).not.toContain(";yes;")
  })

  it("statement lines keep waiver and cap_adjustment, and the totals add up", () => {
    const lines = [
      normaliseStatementLine({ kind: "fee", method: "cash", amount_cents: 3000, base_cents: 2500, full_fee_cents: 250, fee_cents: 250 }),
      normaliseStatementLine({ kind: "waiver", method: "cash", amount_cents: -3000, base_cents: -2500, full_fee_cents: -250, fee_cents: -250 }),
      normaliseStatementLine({ kind: "cap_adjustment", method: "card", amount_cents: 0, base_cents: 0, full_fee_cents: 0, fee_cents: 100 }),
    ]
    expect(lines.map((l) => l.kind)).toEqual(["fee", "waiver", "cap_adjustment"])
    expect(statementTotals(lines)).toMatchObject({ amount_cents: 0, base_cents: 0, fee_cents: 100 })
    expect(lines.map(isCapped)).toEqual([false, false, false])
  })
})

describe("payOutcome", () => {
  it.each([
    [200, { settlement: {} }, "paid"],
    [200, { settlement: {}, adopted_payout: true }, "adopted"],
    [500, { error: "record_failed", settlement: { status: "processing" } }, "submitted"],
    [500, { error: "server_error" }, "error"],
    [502, { error: "stripe_rejected" }, "error"],
    [409, { error: "version_conflict" }, "error"],
  ])("%i %j → %s", (status, body, outcome) => {
    expect(payOutcome(status, body)).toBe(outcome)
  })
})
