import { describe, expect, it } from "vitest"
import {
  businessCsv,
  businessDetailTotals,
  businessOrderLine,
  nameMatches,
  vatOn,
  bpsToPercentString,
  capProgress,
  centsToCsv,
  formatRomeDateTime,
  isCapped,
  normaliseStatement,
  romeIsoDate,
  settlementPeriod,
  statementCsv,
  statementRate,
  statementTotals,
  centsToEuroString,
  formatEuroCents,
  normaliseOverviewRow,
  normaliseSettlement,
  overviewTotals,
  parseEuroToCents,
  parseLocalDate,
  parseRatePercent,
  presetRange,
  romeMidnight,
  romeRange,
  romeToday,
  toInt,
  toIntOrNull,
} from "@/lib/finance"
import { financeError } from "@/lib/finance-error"
import { messages } from "@/lib/i18n/messages"

const plain = (s: string) => s.replace(/\s/g, " ")

describe("Rome calendar dates → timestamps", () => {
  it("parses real dates only", () => {
    expect(parseLocalDate("2026-02-28")).toEqual({ y: 2026, m: 2, d: 28 })
    expect(parseLocalDate("2026-02-29")).toBeNull()
    expect(parseLocalDate("2028-02-29")).toEqual({ y: 2028, m: 2, d: 29 })
    expect(parseLocalDate("2026-13-01")).toBeNull()
    expect(parseLocalDate("2026-1-01")).toBeNull()
    expect(parseLocalDate(null)).toBeNull()
    expect(parseLocalDate("2026-11-23T00:00")).toBeNull()
  })

  it("winter midnight is 23:00 UTC the day before, summer midnight 22:00", () => {
    expect(romeMidnight({ y: 2026, m: 1, d: 1 }).toISOString()).toBe("2025-12-31T23:00:00.000Z")
    expect(romeMidnight({ y: 2026, m: 7, d: 15 }).toISOString()).toBe("2026-07-14T22:00:00.000Z")
  })

  it("handles the spring-forward day (29 March 2026 has 23 hours)", () => {
    const r = romeRange("2026-03-29", "2026-03-29")
    expect(r).toMatchObject({ ok: true, fromTs: "2026-03-28T23:00:00.000Z", toTs: "2026-03-29T22:00:00.000Z", days: 1 })
    if (r.ok) expect(Date.parse(r.toTs) - Date.parse(r.fromTs)).toBe(23 * 3600_000)
  })

  it("handles the fall-back day (25 October 2026 has 25 hours)", () => {
    const r = romeRange("2026-10-25", "2026-10-25")
    expect(r).toMatchObject({ ok: true, fromTs: "2026-10-24T22:00:00.000Z", toTs: "2026-10-25T23:00:00.000Z" })
    if (r.ok) expect(Date.parse(r.toTs) - Date.parse(r.fromTs)).toBe(25 * 3600_000)
  })

  it("spans DST changes and sets the cap month from `to`", () => {
    expect(romeRange("2026-03-01", "2026-04-15")).toEqual({
      ok: true,
      from: "2026-03-01",
      to: "2026-04-15",
      fromTs: "2026-02-28T23:00:00.000Z",
      toTs: "2026-04-15T22:00:00.000Z",
      capMonth: "2026-04-01",
      days: 46,
    })
    // `to` on the last day of a month rolls the exclusive end into the next month.
    expect(romeRange("2026-12-01", "2026-12-31")).toMatchObject({ ok: true, toTs: "2026-12-31T23:00:00.000Z", capMonth: "2026-12-01" })
  })

  it("refuses bad dates, reversed ranges and ranges over 366 days", () => {
    expect(romeRange("2026-11-31", "2026-12-01")).toEqual({ ok: false, error: "invalid_date" })
    expect(romeRange(undefined, "2026-12-01")).toEqual({ ok: false, error: "invalid_date" })
    expect(romeRange("2026-12-02", "2026-12-01")).toEqual({ ok: false, error: "invalid_range" })
    expect(romeRange("2025-01-01", "2026-01-01")).toMatchObject({ ok: true, days: 366 })
    expect(romeRange("2025-01-01", "2026-01-02")).toEqual({ ok: false, error: "invalid_range" })
  })

  it("today and presets follow the Rome calendar", () => {
    // 23:30 UTC on 29 Nov is already Monday 30 Nov in Rome.
    expect(romeToday(new Date("2026-11-29T23:30:00Z"))).toEqual({ y: 2026, m: 11, d: 30 })
    const mon = new Date("2026-11-23T10:00:00Z")
    expect(presetRange("thisMonth", mon)).toEqual({ from: "2026-11-01", to: "2026-11-23" })
    expect(presetRange("thisWeek", mon)).toEqual({ from: "2026-11-23", to: "2026-11-23" })
    expect(presetRange("thisWeek", new Date("2026-11-29T12:00:00Z"))).toEqual({ from: "2026-11-23", to: "2026-11-29" })
    expect(presetRange("lastMonth", new Date("2026-01-15T12:00:00Z"))).toEqual({ from: "2025-12-01", to: "2025-12-31" })
    expect(presetRange("lastMonth", new Date("2026-03-10T12:00:00Z"))).toEqual({ from: "2026-02-01", to: "2026-02-28" })
  })
})

describe("percent and euro parsing", () => {
  it("rate percent → basis points without float drift", () => {
    expect(parseRatePercent(15)).toBe(1500)
    expect(parseRatePercent(15.5)).toBe(1550)
    expect(parseRatePercent(15.55)).toBe(1555)
    expect(parseRatePercent(0.29)).toBe(29) // 0.29 * 100 = 28.999… in floats
    expect(parseRatePercent(0)).toBe(0)
    expect(parseRatePercent(100)).toBe(10000)
    expect(parseRatePercent("12,5")).toBe(1250)
  })

  it("refuses rates outside 0–100 or with more than two decimals", () => {
    for (const v of [100.01, 101, -1, 15.555, 0.1 + 0.2, 1e-7, Number.NaN, Infinity, "abc", "", null, true]) {
      expect(parseRatePercent(v), String(v)).toBeNull()
    }
  })

  it("euro → cents", () => {
    expect(parseEuroToCents(250)).toBe(25000)
    expect(parseEuroToCents(0)).toBe(0)
    expect(parseEuroToCents(0.29)).toBe(29)
    expect(parseEuroToCents(1234.56)).toBe(123456)
    expect(parseEuroToCents("19,9")).toBe(1990)
    for (const v of [-0.01, 1.005, 1e21, "1e3", Number.NaN]) expect(parseEuroToCents(v), String(v)).toBeNull()
  })

  it("integers back to input strings", () => {
    expect(bpsToPercentString(1550)).toBe("15.5")
    expect(bpsToPercentString(1500)).toBe("15")
    expect(bpsToPercentString(5)).toBe("0.05")
    expect(centsToEuroString(25050)).toBe("250.5")
    expect(centsToEuroString(25000)).toBe("250")
    for (const bps of [0, 1, 99, 1234, 10000]) expect(parseRatePercent(bpsToPercentString(bps))).toBe(bps)
  })
})

describe("cap progress", () => {
  it("no cap, under, ≥ 80 % and reached", () => {
    expect(capProgress(10000, null)).toEqual({ state: "none", ratio: 0 })
    expect(capProgress(18000, 25000)).toEqual({ state: "ok", ratio: 0.72 })
    expect(capProgress(20000, 25000)).toEqual({ state: "near", ratio: 0.8 })
    expect(capProgress(19999, 25000).state).toBe("ok")
    expect(capProgress(25000, 25000)).toEqual({ state: "reached", ratio: 1 })
    expect(capProgress(0, 0).state).toBe("reached")
    expect(capProgress(100, 25000, "2026-11-20T10:00:00Z").state).toBe("reached")
  })
})

describe("rows and formatting", () => {
  it("formats cents as it-IT euro", () => {
    expect(plain(formatEuroCents(18000))).toBe("180,00 €")
    expect(plain(formatEuroCents(12345678))).toBe("123.456,78 €")
    expect(plain(formatEuroCents(-1234))).toBe("-12,34 €")
  })

  it("normalises bigint strings", () => {
    expect(toInt("12345678901")).toBe(12345678901)
    expect(toInt("-5")).toBe(-5)
    expect(toInt(null)).toBe(0)
    expect(toInt("x")).toBe(0)
    expect(toIntOrNull(null)).toBeNull()
    expect(toIntOrNull("25000")).toBe(25000)
    const row = normaliseOverviewRow({
      business_id: "b1",
      business_name: "Hosuto",
      slug: "hosuto",
      orders_count: "3",
      gross_cents: "4500",
      net_cents: "-200",
      rate_bps: 1500,
      monthly_cap_cents: null,
      cap_month_fee_cents: "675",
      cap_reached_at: null,
    })
    expect(row).toMatchObject({ orders_count: 3, gross_cents: 4500, net_cents: -200, monthly_cap_cents: null, cash_cents: 0 })
    expect(overviewTotals([row, { ...row, net_cents: 500 }])).toMatchObject({ orders_count: 6, gross_cents: 9000, net_cents: 300 })
  })

  it("normalises a settlement with its restaurant", () => {
    const s = normaliseSettlement({ id: "s1", business_id: "b1", status: "paid", payout_cents: "1200", version: "3" }, { business_name: "Hosuto", slug: "hosuto" })
    expect(s).toMatchObject({ id: "s1", status: "paid", payout_cents: 1200, version: 3, business_name: "Hosuto", failure_reason: null })
  })
})

describe("finance error messages", () => {
  const t = messages.en
  it("shows the available balance and Stripe's code", () => {
    expect(plain(financeError(t, { error: "insufficient_available_balance", available_cents: 4200 }, 409))).toContain("42,00 €")
    expect(financeError(t, { error: "insufficient_available_balance" }, 409)).toBe(t.finance.errors.insufficient_available_balance_unknown)
    expect(financeError(t, { error: "stripe_rejected", code: "account_closed" }, 502)).toContain("account_closed")
    expect(financeError(t, { error: "payout_account_not_ready" }, 409)).toBe(t.finance.errors.payout_account_not_ready)
    expect(financeError(t, {}, 401)).toBe(t.common.unauthenticated)
  })
})

describe("VAT, Stripe fees and subtotal base", () => {
  it("overview rows and totals carry base, IVA and Stripe fees", () => {
    const row = normaliseOverviewRow({ business_id: "b1", base_cents: "4000", fee_cents: "600", vat_cents: "132", stripe_fee_cents: "95", net_cents: "-827" })
    expect(row).toMatchObject({ base_cents: 4000, fee_cents: 600, vat_cents: 132, stripe_fee_cents: 95, net_cents: -827 })
    expect(overviewTotals([row, row])).toMatchObject({ base_cents: 8000, vat_cents: 264, stripe_fee_cents: 190, net_cents: -1654 })
  })

  it("settlements carry base, vat_bps, IVA and Stripe fees", () => {
    const s = normaliseSettlement({ id: "s1", base_cents: "4000", vat_bps: 2200, vat_cents: "132", stripe_fee_cents: "95", owed_cents: "827" })
    expect(s).toMatchObject({ base_cents: 4000, vat_bps: 2200, vat_cents: 132, stripe_fee_cents: 95, owed_cents: 827 })
  })
})

describe("settlement statement", () => {
  const raw = {
    settlement: { id: "s1", business_id: "b1", status: "processing", period_start: "2026-11-15T23:00:00Z", period_end: "2026-11-22T23:00:00Z", base_cents: "3000", vat_bps: 2200 },
    business: { business_id: "b1", name: "Hosuto", tax_id: "01234567897", address: null, email: "x@example.com", order_email: null, slug: "hosuto" },
    settings: { rate_bps: 1500, monthly_cap_cents: "25000" },
    month: { fee_cents: "25000", cap_reached_at: "2026-11-20T10:00:00Z" },
    lines: [
      { order_number: 1042, occurred_at: "2026-11-16T11:05:00Z", kind: "fee", method: "card", amount_cents: "2500", base_cents: "2000", card_cents: "2500", rate_bps: 1500, full_fee_cents: "300", fee_cents: "300", stripe_fee_cents: "61" },
      { order_number: "1043", occurred_at: "2026-11-20T18:30:00Z", kind: "fee", method: "cash", amount_cents: "1200", base_cents: "1000", card_cents: "0", rate_bps: 1500, full_fee_cents: "150", fee_cents: "40", stripe_fee_cents: "0" },
      { order_number: 1042, occurred_at: "2026-11-21T09:00:00Z", kind: "reversal", method: "card", amount_cents: "-2500", base_cents: "-2000", card_cents: "-2500", rate_bps: 1500, full_fee_cents: "-300", fee_cents: "-300", stripe_fee_cents: "0" },
    ],
  }

  it("normalises the jsonb, null when absent", () => {
    expect(normaliseStatement(null)).toBeNull()
    const st = normaliseStatement(raw)!
    expect(st.settlement).toMatchObject({ id: "s1", business_name: "Hosuto", slug: "hosuto", base_cents: 3000 })
    expect(st.business).toMatchObject({ name: "Hosuto", tax_id: "01234567897", address: null })
    expect(st.settings).toEqual({ rate_bps: 1500, monthly_cap_cents: 25000 })
    expect(st.month).toEqual({ fee_cents: 25000, cap_reached_at: "2026-11-20T10:00:00Z" })
    expect(st.lines[0]).toMatchObject({ order_number: "1042", amount_cents: 2500, stripe_fee_cents: 61 })
    expect(st.lines.map(isCapped)).toEqual([false, true, false])
    expect(statementRate(st)).toBe(1500)
    expect(statementTotals(st.lines)).toEqual({ amount_cents: 1200, base_cents: 1000, fee_cents: 40, stripe_fee_cents: 61, card_cents: 0 })
  })

  it("falls back to the current rate when lines disagree or there are none", () => {
    const st = normaliseStatement({ ...raw, lines: [] })!
    expect(statementRate(st)).toBe(1500)
    const mixed = normaliseStatement({ ...raw, settings: { rate_bps: 1000 }, lines: [{ ...raw.lines[0] }, { ...raw.lines[1], rate_bps: 1200 }] })!
    expect(statementRate(mixed)).toBe(1000)
  })

  it("shows the period Monday–Sunday in Rome (period_end exclusive)", () => {
    expect(settlementPeriod({ period_start: "2026-11-15T23:00:00Z", period_end: "2026-11-22T23:00:00Z" })).toEqual({ first: "16/11/2026", last: "22/11/2026" })
    // Week of the October DST change: Monday 19 Oct (CEST) to Monday 26 Oct (CET).
    expect(settlementPeriod({ period_start: "2026-10-18T22:00:00Z", period_end: "2026-10-25T23:00:00Z" })).toEqual({ first: "19/10/2026", last: "25/10/2026" })
    expect(romeIsoDate("2026-11-15T23:00:00Z")).toBe("2026-11-16")
    expect(formatRomeDateTime("2026-11-16T11:05:00Z")).toBe("16/11/2026, 12:05")
  })

  it("builds a ; separated CSV with comma decimals", () => {
    expect(centsToCsv(123456)).toBe("1234,56")
    expect(centsToCsv(-5)).toBe("-0,05")
    expect(centsToCsv(0)).toBe("0,00")
    const st = normaliseStatement(raw)!
    const m = messages.it.finance.statement
    const csv = statementCsv(st.lines, { ...m.cols, kinds: m.kinds, methods: m.methods, yes: m.yes })
    const rows = csv.trimEnd().split("\r\n")
    expect(rows).toHaveLength(4)
    expect(rows[0]).toBe("Ordine n.;Data;Tipo;Pagamento;Totale;Subtotale prodotti;Aliquota %;Commissione;Tetto;Comm. Stripe;Incassato carta")
    expect(rows[1]).toBe("1042;16/11/2026, 12:05;Ordine;Carta;25,00;20,00;15,00;3,00;;0,61;25,00")
    expect(rows[2]).toBe("1043;20/11/2026, 19:30;Ordine;Contanti;12,00;10,00;15,00;0,40;sì;0,00;0,00")
    expect(rows[3]).toBe("1042;21/11/2026, 10:00;Rimborso;Carta;-25,00;-20,00;15,00;-3,00;;0,00;-25,00")
  })

  it("quotes cells that contain the separator", () => {
    const csv = statementCsv([], { ...messages.en.finance.statement.cols, order: 'Order; "#"', kinds: messages.en.finance.statement.kinds, methods: messages.en.finance.statement.methods, yes: "yes" })
    expect(csv.startsWith('"Order; ""#""";Date')).toBe(true)
  })
})

describe("one restaurant's order lines", () => {
  const entry = (o: Partial<Record<string, unknown>>) => ({
    order_id: "o1",
    kind: "fee",
    method: "card",
    occurred_at: "2026-11-24T00:03:05Z",
    amount_cents: "3000",
    base_cents: "2500",
    card_cents: "3000",
    rate_bps: 1000,
    full_fee_cents: "250",
    fee_cents: "250",
    ...o,
  })

  it("rounds IVA half away from zero, like Postgres", () => {
    expect(vatOn(250)).toBe(55)
    expect(vatOn(25)).toBe(6) // 5.5 → 6
    expect(vatOn(-25)).toBe(-6)
    expect(vatOn(0)).toBe(0)
  })

  it("filters names ignoring case and accents", () => {
    expect(nameMatches("Caffè Rossi", "caffe")).toBe(true)
    expect(nameMatches("Caffè Rossi", "  ROSS ")).toBe(true)
    expect(nameMatches("Caffè Rossi", "bianchi")).toBe(false)
    expect(nameMatches("anything", "")).toBe(true)
  })

  it("a card order: net = card − commission − IVA − Stripe fee", () => {
    const l = businessOrderLine(entry({}), "1042", 59)
    expect(l).toMatchObject({ order_number: "1042", gross_cents: 3000, card_cents: 3000, cash_cents: 0, refund_cents: 0, fee_cents: 250, vat_cents: 55, stripe_fee_cents: 59 })
    expect(l.net_cents).toBe(3000 - 250 - 55 - 59)
  })

  it("a card order without its Stripe fee yet is pending (null) and counted as 0", () => {
    const l = businessOrderLine(entry({}), "1042", null)
    expect(l.stripe_fee_cents).toBeNull()
    expect(l.net_cents).toBe(3000 - 250 - 55)
    expect(businessDetailTotals([l]).stripe_fee_pending).toBe(1)
  })

  it("a cash order has no card money and no Stripe fee: its commission is a deficit", () => {
    const l = businessOrderLine(entry({ method: "cash", card_cents: 0 }), "7", null)
    expect(l).toMatchObject({ gross_cents: 3000, cash_cents: 3000, card_cents: 0, stripe_fee_cents: 0, net_cents: -305 })
  })

  it("a refund is its own line: no gross, refund amount, commission back, no Stripe fee back", () => {
    const l = businessOrderLine(entry({ kind: "reversal", amount_cents: -3000, base_cents: -2500, card_cents: -3000, fee_cents: -250, full_fee_cents: -250 }), "1042", 59)
    expect(l).toMatchObject({ gross_cents: 0, refund_cents: 3000, fee_cents: -250, vat_cents: -55, stripe_fee_cents: 0, net_cents: -3000 + 250 + 55 })
  })

  it("totals match the overview: IVA on the summed commission", () => {
    const a = businessOrderLine(entry({ fee_cents: 25, full_fee_cents: 25 }), "1", 10)
    const b = businessOrderLine(entry({ order_id: "o2", fee_cents: 25, full_fee_cents: 25 }), "2", 10)
    const c = businessOrderLine(entry({ order_id: "o3", method: "cash", card_cents: 0, amount_cents: 1000, fee_cents: 100, full_fee_cents: 100 }), "3", null)
    const t = businessDetailTotals([a, b, c])
    expect(t).toMatchObject({ orders_count: 3, card_orders: 2, cash_orders: 1, gross_cents: 7000, card_cents: 6000, cash_cents: 1000, fee_cents: 150, vat_cents: 33, stripe_fee_cents: 20, stripe_fee_pending: 0 })
    expect(t.net_cents).toBe(6000 - 150 - 33 - 20)
  })
})

describe("restaurant orders CSV", () => {
  const labels = {
    ...messages.en.finance.business.cols,
    rate: "Rate %",
    capped: "Capped",
    kinds: messages.en.finance.business.kinds,
    methods: messages.en.finance.business.methods,
    yes: "yes",
    pending: "pending",
    totals: "Total",
  }
  const e = {
    order_id: "o1", kind: "fee", method: "card", occurred_at: "2026-11-24T00:03:05Z",
    amount_cents: 3000, base_cents: 2500, card_cents: 3000, rate_bps: 1000, full_fee_cents: 300, fee_cents: 250,
  }

  it("writes a header, one row per line (pending Stripe fee as text) and a total row", () => {
    const csv = businessCsv([businessOrderLine(e, "10;42", null)], labels)
    const rows = csv.split("\r\n")
    expect(rows).toHaveLength(4) // header, line, total, trailing empty
    expect(rows[0].split(";")).toHaveLength(15)
    expect(rows[1]).toBe('"10;42";24/11/2026, 01:03;Order;Card;30,00;0,00;30,00;0,00;25,00;10,00;2,50;yes;0,55;pending;26,95')
    expect(rows[2]).toBe("Total;;;;30,00;0,00;30,00;0,00;25,00;;2,50;;0,55;0,00;26,95")
    expect(csv.endsWith("\r\n")).toBe(true)
  })
})
