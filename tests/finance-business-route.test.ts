import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/superadmin-auth", () => ({ lookupOperator: vi.fn() }))
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: vi.fn() }))

import { lookupOperator } from "@/lib/superadmin-auth"
import { createAdminClient } from "@/lib/supabase-admin"
import * as route from "@/app/api/finance/business/route"

const BIZ = "00000000-0000-4000-8000-000000000001"
const O1 = "00000000-0000-4000-8000-0000000000a1"
const O2 = "00000000-0000-4000-8000-0000000000a2"

type Result = { data: unknown; error: { code?: string } | null }
const calls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = []

/** A thenable query builder that records its calls and resolves with tables[table]. */
function fakeAdmin(tables: Record<string, Result>) {
  return {
    from(table: string) {
      const rec = { table, ops: [] as Array<[string, unknown[]]> }
      calls.push(rec)
      const q: Record<string, unknown> = {}
      for (const op of ["select", "eq", "gte", "lt", "order", "range", "in"]) {
        q[op] = (...args: unknown[]) => {
          rec.ops.push([op, args])
          return q
        }
      }
      // The waiver lookup (kind = waiver) answers from `<table>:waiver`.
      const pick = () =>
        rec.ops.some(([op, a]) => op === "eq" && a[0] === "kind" && a[1] === "waiver")
          ? (tables[`${table}:waiver`] ?? { data: [], error: null })
          : tables[table]
      q.maybeSingle = () => Promise.resolve(pick())
      q.then = (res: (r: Result) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(pick()).then(res, rej)
      return q
    },
  }
}

const get = (qs: string) => route.GET(new Request(`http://localhost/api/finance/business?${qs}`))

beforeEach(() => {
  calls.length = 0
  vi.mocked(createAdminClient).mockReset()
  vi.mocked(lookupOperator).mockResolvedValue({ status: "operator", admin: { userId: "u1", email: null } })
})

describe("GET /api/finance/business", () => {
  it.each([
    [`business_id=nope&from=2026-11-01&to=2026-11-23`, "invalid_business_id"],
    [`business_id=${BIZ}&from=2026-11-01`, "invalid_date"],
    [`business_id=${BIZ}&from=2026-12-02&to=2026-12-01`, "invalid_range"],
  ])("refuses %s before the service-role client", async (qs, code) => {
    const res = await get(qs)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: code })
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("404 for an unknown restaurant", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({ businesses: { data: null, error: null }, commission_settings: { data: null, error: null }, commission_months: { data: null, error: null } }) as never,
    )
    const res = await get(`business_id=${BIZ}&from=2026-11-01&to=2026-11-23`)
    expect(res.status).toBe(404)
  })

  it("503 when the ledger isn't on this database", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        businesses: { data: { business_id: BIZ, business_name: "Hosuto", slug: "hosuto" }, error: null },
        commission_settings: { data: null, error: null },
        commission_months: { data: null, error: null },
        commission_entries: { data: null, error: { code: "42P01" } },
      }) as never,
    )
    const res = await get(`business_id=${BIZ}&from=2026-11-01&to=2026-11-23`)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "finance_unavailable" })
  })

  it("returns one line per entry with order numbers and Stripe fees (pending when missing), scoped to the restaurant and range", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        businesses: { data: { business_id: BIZ, business_name: "Hosuto", slug: "hosuto" }, error: null },
        commission_settings: { data: { rate_bps: 1000, monthly_cap_cents: "5000" }, error: null },
        commission_months: { data: { fee_cents: "250", cap_reached_at: null }, error: null },
        commission_entries: {
          data: [
            { order_id: O1, kind: "fee", method: "card", occurred_at: "2026-11-24T00:03:05Z", amount_cents: "3000", base_cents: "2500", card_cents: "3000", rate_bps: 1000, full_fee_cents: "250", fee_cents: "250" },
            { order_id: O2, kind: "fee", method: "card", occurred_at: "2026-11-24T00:14:22Z", amount_cents: "2700", base_cents: "2200", card_cents: "2700", rate_bps: 1000, full_fee_cents: "220", fee_cents: "220" },
          ],
          error: null,
        },
        orders: { data: [{ id: O1, order_number: "1042" }, { id: O2, order_number: 1043 }], error: null },
        card_fees: { data: [{ order_id: O1, fee_cents: "59" }], error: null },
      }) as never,
    )
    const res = await get(`business_id=${BIZ}&from=2026-11-01&to=2026-11-24`)
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-24",
      cap_month: "2026-11-01",
      business: { business_id: BIZ, business_name: "Hosuto", slug: "hosuto" },
      settings: { rate_bps: 1000, monthly_cap_cents: 5000 },
      cap: { fee_cents: 250, cap_reached_at: null },
    })
    expect(j.lines).toHaveLength(2)
    expect(j.lines[0]).toMatchObject({ order_number: "1042", stripe_fee_cents: 59, net_cents: 3000 - 250 - 55 - 59 })
    expect(j.lines[1]).toMatchObject({ order_number: "1043", stripe_fee_cents: null })

    const entries = calls.find((c) => c.table === "commission_entries")!
    expect(entries.ops).toContainEqual(["eq", ["business_id", BIZ]])
    expect(entries.ops).toContainEqual(["order", ["occurred_at", { ascending: false }]])
    expect(entries.ops).toContainEqual(["gte", ["occurred_at", "2026-10-31T23:00:00.000Z"]])
    expect(entries.ops).toContainEqual(["lt", ["occurred_at", "2026-11-24T23:00:00.000Z"]])
    for (const t of ["orders", "card_fees"]) expect(calls.find((c) => c.table === t)!.ops).toContainEqual(["eq", ["business_id", BIZ]])
  })

  it("shows waivers and cap adjustments as commission-only lines and marks waivable cash fees", async () => {
    const O3 = "00000000-0000-4000-8000-0000000000a3"
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdmin({
        businesses: { data: { business_id: BIZ, business_name: "Hosuto", slug: "hosuto" }, error: null },
        commission_settings: { data: { rate_bps: 1000, monthly_cap_cents: "300" }, error: null },
        commission_months: { data: { fee_cents: "300", cap_reached_at: null }, error: null },
        commission_entries: {
          data: [
            { id: "e4", order_id: O2, kind: "cap_adjustment", method: "card", occurred_at: "2026-11-24T10:00:00Z", amount_cents: 0, base_cents: 0, card_cents: 0, rate_bps: 1000, full_fee_cents: 0, fee_cents: "100" },
            { id: "e3", order_id: O1, kind: "waiver", method: "cash", occurred_at: "2026-11-24T09:00:00Z", amount_cents: "-3000", base_cents: "-2500", card_cents: 0, rate_bps: 1000, full_fee_cents: "-250", fee_cents: "-250" },
            { id: "e2", order_id: O2, kind: "fee", method: "card", occurred_at: "2026-11-24T00:14:22Z", amount_cents: "2700", base_cents: "2200", card_cents: "2700", rate_bps: 1000, full_fee_cents: "220", fee_cents: "50" },
            { id: "e1", order_id: O1, kind: "fee", method: "cash", occurred_at: "2026-11-24T00:03:05Z", amount_cents: "3000", base_cents: "2500", card_cents: 0, rate_bps: 1000, full_fee_cents: "250", fee_cents: "250" },
            { id: "e0", order_id: O3, kind: "fee", method: "cash", occurred_at: "2026-11-23T20:00:00Z", amount_cents: "1000", base_cents: "1000", card_cents: 0, rate_bps: 1000, full_fee_cents: "100", fee_cents: "0" },
          ],
          error: null,
        },
        "commission_entries:waiver": { data: [{ order_id: O1 }], error: null },
        orders: { data: [{ id: O1, order_number: 1 }, { id: O2, order_number: 2 }, { id: O3, order_number: 3 }], error: null },
        card_fees: { data: [{ order_id: O2, fee_cents: "40" }], error: null },
      }) as never,
    )
    const res = await get(`business_id=${BIZ}&from=2026-11-01&to=2026-11-24`)
    const j = await res.json()
    const byEntry = Object.fromEntries((j.lines as Array<Record<string, unknown>>).map((l) => [l.entry_id, l]))
    expect(byEntry.e4).toMatchObject({ kind: "cap_adjustment", gross_cents: 0, card_cents: 0, fee_cents: 100, stripe_fee_cents: 0, waivable: false })
    expect(byEntry.e3).toMatchObject({ kind: "waiver", gross_cents: -3000, cash_cents: -3000, card_cents: 0, refund_cents: 0, fee_cents: -250, net_cents: 250 + 55, waivable: false })
    expect(byEntry.e2).toMatchObject({ kind: "fee", stripe_fee_cents: 40, waivable: false })
    // O1 already has a waiver; O3 doesn't.
    expect(byEntry.e1).toMatchObject({ kind: "fee", method: "cash", waivable: false })
    expect(byEntry.e0).toMatchObject({ kind: "fee", method: "cash", waivable: true })
  })
})
