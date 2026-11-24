// Finance / settlements helpers shared by the /api/finance routes and the
// /finance page. Pure functions only (no server imports), so the browser can
// use the same parsing and formatting as the server.
//
// Money is integer cents and commission rates integer basis points
// (1500 = 15 %) everywhere; user input is parsed from its decimal string, never
// through floating-point maths.

export const ROME_TZ = "Europe/Rome"

/** Longest range the overview accepts, in calendar days (inclusive). */
export const MAX_RANGE_DAYS = 366

export const SETTLEMENT_STATUSES = ["pending_approval", "approved", "processing", "paid", "failed", "cancelled"] as const
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number]

export function isSettlementStatus(v: unknown): v is SettlementStatus {
  return typeof v === "string" && (SETTLEMENT_STATUSES as readonly string[]).includes(v)
}

/** "Approve & pay" works on these; the Edge Function approves a pending one first. */
export const PAYABLE_STATUSES: readonly SettlementStatus[] = ["pending_approval", "approved", "failed"]
/** Only a pending settlement can be cancelled (and only the restaurant's latest). */
export const CANCELLABLE_STATUSES: readonly SettlementStatus[] = ["pending_approval"]

// ---------------------------------------------------------------------------
// Calendar dates in Europe/Rome
// ---------------------------------------------------------------------------

export interface LocalDate {
  y: number
  m: number // 1–12
  d: number
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** "2026-03-29" → { y, m, d } for a real calendar date, else null. */
export function parseLocalDate(v: unknown): LocalDate | null {
  if (typeof v !== "string") return null
  const m = DATE_RE.exec(v)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null
  return { y, m: mo, d }
}

const pad2 = (n: number) => String(n).padStart(2, "0")

export function formatLocalDate(d: LocalDate): string {
  return `${d.y}-${pad2(d.m)}-${pad2(d.d)}`
}

/** The date `days` calendar days after `d` (negative goes back). */
export function addDays(d: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(d.y, d.m - 1, d.d + days))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}

/** Whole calendar days from `a` to `b` (b − a). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000)
}

const romeParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: ROME_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
})

/** Wall-clock fields of an instant in Europe/Rome. */
function romeWallClock(ms: number) {
  const p = Object.fromEntries(romeParts.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), min: Number(p.minute), s: Number(p.second) }
}

/** Europe/Rome's offset from UTC at an instant, in ms (+1 h in winter, +2 h in summer). */
function romeOffsetMs(ms: number): number {
  const w = romeWallClock(ms)
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(ms / 1000) * 1000
}

/**
 * The instant of 00:00 Europe/Rome on a calendar date. Italy changes clocks at
 * 02:00/03:00, so midnight always exists exactly once; two passes settle the
 * offset on the DST change days.
 */
export function romeMidnight(d: LocalDate): Date {
  const wall = Date.UTC(d.y, d.m - 1, d.d)
  let guess = wall - romeOffsetMs(wall)
  guess = wall - romeOffsetMs(guess)
  return new Date(guess)
}

/** Today's calendar date in Europe/Rome. */
export function romeToday(now: Date = new Date()): LocalDate {
  const w = romeWallClock(now.getTime())
  return { y: w.y, m: w.m, d: w.d }
}

export type RangeResult =
  | {
      ok: true
      from: string
      to: string
      /** [from 00:00 Rome, to + 1 day 00:00 Rome) as ISO timestamps. */
      fromTs: string
      toTs: string
      /** First day of the month containing `to` (the cap's month). */
      capMonth: string
      days: number
    }
  | { ok: false; error: "invalid_date" | "invalid_range" }

/** Validate a From / To pair of Rome calendar dates (`to` inclusive). */
export function romeRange(fromRaw: unknown, toRaw: unknown): RangeResult {
  const from = parseLocalDate(fromRaw)
  const to = parseLocalDate(toRaw)
  if (!from || !to) return { ok: false, error: "invalid_date" }
  const span = daysBetween(from, to)
  if (span < 0 || span + 1 > MAX_RANGE_DAYS) return { ok: false, error: "invalid_range" }
  return {
    ok: true,
    from: formatLocalDate(from),
    to: formatLocalDate(to),
    fromTs: romeMidnight(from).toISOString(),
    toTs: romeMidnight(addDays(to, 1)).toISOString(),
    capMonth: formatLocalDate({ y: to.y, m: to.m, d: 1 }),
    days: span + 1,
  }
}

export type PresetKey = "thisMonth" | "lastMonth" | "thisWeek"

/** Quick ranges, as Rome calendar dates. Weeks start on Monday, like settlements. */
export function presetRange(key: PresetKey, now: Date = new Date()): { from: string; to: string } {
  const today = romeToday(now)
  if (key === "thisMonth") return { from: formatLocalDate({ ...today, d: 1 }), to: formatLocalDate(today) }
  if (key === "lastMonth") {
    const firstThis = { ...today, d: 1 }
    const lastPrev = addDays(firstThis, -1)
    return { from: formatLocalDate({ ...lastPrev, d: 1 }), to: formatLocalDate(lastPrev) }
  }
  const weekday = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay() // 0 = Sunday
  const monday = addDays(today, -((weekday + 6) % 7))
  return { from: formatLocalDate(monday), to: formatLocalDate(today) }
}

// ---------------------------------------------------------------------------
// Decimal input → integer cents / basis points
// ---------------------------------------------------------------------------

const DECIMAL_RE = /^(\d+)(?:\.(\d{1,2}))?$/

/** "12,5" / " 12.50 " → "12.5"-style canonical string for the parsers below; anything else stays as typed. */
export function normaliseDecimalInput(v: string): string {
  return v.trim().replace(",", ".")
}

/** A number or decimal string with at most two decimals → integer hundredths, else null. */
function toHundredths(v: unknown): number | null {
  let s: string
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 0) return null
    s = String(v) // shortest round-trip form: 15.5 → "15.5", 1e-7 → "1e-7" (refused)
  } else if (typeof v === "string") {
    s = normaliseDecimalInput(v)
  } else return null
  const m = DECIMAL_RE.exec(s)
  if (!m) return null
  const whole = m[1].replace(/^0+(?=\d)/, "")
  if (whole.length > 13) return null
  const frac = (m[2] ?? "").padEnd(2, "0")
  return Number(whole) * 100 + Number(frac)
}

/** Commission rate in percent (0–100, ≤ 2 decimals) → basis points, else null. 15.5 → 1550. */
export function parseRatePercent(v: unknown): number | null {
  const h = toHundredths(v)
  if (h === null || h > 10_000) return null
  return h
}

/** Euro amount (≥ 0, ≤ 2 decimals) → cents, else null. 250 → 25000. */
export function parseEuroToCents(v: unknown): number | null {
  const h = toHundredths(v)
  if (h === null || !Number.isSafeInteger(h)) return null
  return h
}

/** 1550 → "15.5", 1500 → "15", 5 → "0.05" (for an input's value). */
export function bpsToPercentString(bps: number): string {
  return hundredthsToString(bps)
}

/** 25000 → "250", 25050 → "250.5", 5 → "0.05" (for an input's value). */
export function centsToEuroString(cents: number): string {
  return hundredthsToString(cents)
}

function hundredthsToString(n: number): string {
  const whole = Math.trunc(n / 100)
  const frac = String(Math.abs(n % 100)).padStart(2, "0").replace(/0+$/, "")
  return frac ? `${whole}.${frac}` : String(whole)
}

// ---------------------------------------------------------------------------
// Rows from the database (bigints may arrive as strings)
// ---------------------------------------------------------------------------

/** A bigint/int column as a number (0 when absent or unreadable). */
export function toInt(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : 0
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim())
  return 0
}

/** A nullable bigint column: null stays null. */
export function toIntOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : toInt(v)
}

export interface FinanceOverviewRow {
  business_id: string
  business_name: string
  slug: string
  orders_count: number
  card_orders: number
  cash_orders: number
  gross_cents: number
  card_cents: number
  cash_cents: number
  card_refunds_cents: number
  /** Products subtotal after offer discounts: the commission base. */
  base_cents: number
  /** Commission before IVA. */
  fee_cents: number
  /** 22 % IVA on the commission. */
  vat_cents: number
  /** Stripe card fees passed on to the restaurant. */
  stripe_fee_cents: number
  /** Card net − commission − IVA − Stripe fees in the range; negative = deficit owed to the platform. */
  net_cents: number
  rate_bps: number
  monthly_cap_cents: number | null
  cap_month_fee_cents: number
  cap_reached_at: string | null
  pending_payout_cents: number
  pending_settlements: number
  open_deficit_cents: number
}

const OVERVIEW_INT_COLS = [
  "orders_count",
  "card_orders",
  "cash_orders",
  "gross_cents",
  "card_cents",
  "cash_cents",
  "card_refunds_cents",
  "base_cents",
  "fee_cents",
  "vat_cents",
  "stripe_fee_cents",
  "net_cents",
  "rate_bps",
  "cap_month_fee_cents",
  "pending_payout_cents",
  "pending_settlements",
  "open_deficit_cents",
] as const

export function normaliseOverviewRow(r: Record<string, unknown>): FinanceOverviewRow {
  const out = {
    business_id: String(r.business_id ?? ""),
    business_name: String(r.business_name ?? ""),
    slug: String(r.slug ?? ""),
    monthly_cap_cents: toIntOrNull(r.monthly_cap_cents),
    cap_reached_at: typeof r.cap_reached_at === "string" ? r.cap_reached_at : null,
  } as FinanceOverviewRow
  for (const k of OVERVIEW_INT_COLS) out[k] = toInt(r[k])
  return out
}

export type OverviewTotals = Pick<
  FinanceOverviewRow,
  | "orders_count"
  | "gross_cents"
  | "card_cents"
  | "cash_cents"
  | "card_refunds_cents"
  | "base_cents"
  | "fee_cents"
  | "vat_cents"
  | "stripe_fee_cents"
  | "net_cents"
>

export function overviewTotals(rows: FinanceOverviewRow[]): OverviewTotals {
  const t: OverviewTotals = {
    orders_count: 0,
    gross_cents: 0,
    card_cents: 0,
    cash_cents: 0,
    card_refunds_cents: 0,
    base_cents: 0,
    fee_cents: 0,
    vat_cents: 0,
    stripe_fee_cents: 0,
    net_cents: 0,
  }
  for (const r of rows) for (const k of Object.keys(t) as (keyof OverviewTotals)[]) t[k] += r[k]
  return t
}

export interface Settlement {
  id: string
  business_id: string
  business_name: string | null
  slug: string | null
  period_start: string
  period_end: string
  month: string
  status: SettlementStatus
  orders_count: number
  card_orders: number
  cash_orders: number
  card_gross_cents: number
  card_refunds_cents: number
  card_net_cents: number
  cash_cents: number
  fee_card_cents: number
  fee_cash_cents: number
  fee_cents: number
  /** Products subtotal the commission was taken on. */
  base_cents: number
  vat_bps: number
  vat_cents: number
  stripe_fee_cents: number
  carry_in_cents: number
  /** fee + vat + stripe_fee + carry_in. */
  owed_cents: number
  payout_cents: number
  deficit_cents: number
  version: number
  approved_by: string | null
  approved_at: string | null
  payout_attempt: number
  stripe_transfer_id: string | null
  stripe_payout_id: string | null
  failure_reason: string | null
  paid_at: string | null
  cancel_reason: string | null
  /** The operator who started the latest payment attempt (settlement_start_payment). */
  payment_started_by: string | null
  payment_started_at: string | null
  /** Last time order-worker checked this processing settlement against Stripe. */
  reconciled_at: string | null
  /** payment_started_by's sign-in email, filled by GET /api/finance/settlements (operators only). */
  payment_started_by_email?: string | null
  created_at: string
}

export const SETTLEMENT_COLUMNS =
  "id, business_id, period_start, period_end, month, status, orders_count, card_orders, cash_orders, card_gross_cents, card_refunds_cents, card_net_cents, cash_cents, fee_card_cents, fee_cash_cents, fee_cents, base_cents, vat_bps, vat_cents, stripe_fee_cents, carry_in_cents, owed_cents, payout_cents, deficit_cents, version, approved_by, approved_at, payout_attempt, stripe_transfer_id, stripe_payout_id, failure_reason, paid_at, cancel_reason, payment_started_by, payment_started_at, reconciled_at, created_at"

const SETTLEMENT_INT_COLS = [
  "orders_count",
  "card_orders",
  "cash_orders",
  "card_gross_cents",
  "card_refunds_cents",
  "card_net_cents",
  "cash_cents",
  "fee_card_cents",
  "fee_cash_cents",
  "fee_cents",
  "base_cents",
  "vat_bps",
  "vat_cents",
  "stripe_fee_cents",
  "carry_in_cents",
  "owed_cents",
  "payout_cents",
  "deficit_cents",
  "version",
  "payout_attempt",
] as const
const SETTLEMENT_TEXT_COLS = [
  "approved_by",
  "approved_at",
  "stripe_transfer_id",
  "stripe_payout_id",
  "failure_reason",
  "paid_at",
  "cancel_reason",
  "payment_started_by",
  "payment_started_at",
  "reconciled_at",
] as const

export function normaliseSettlement(r: Record<string, unknown>, business?: { business_name?: unknown; slug?: unknown } | null): Settlement {
  const out = {
    id: String(r.id ?? ""),
    business_id: String(r.business_id ?? ""),
    business_name: typeof business?.business_name === "string" ? business.business_name : null,
    slug: typeof business?.slug === "string" ? business.slug : null,
    period_start: String(r.period_start ?? ""),
    period_end: String(r.period_end ?? ""),
    month: String(r.month ?? ""),
    status: (isSettlementStatus(r.status) ? r.status : "pending_approval") as SettlementStatus,
    created_at: String(r.created_at ?? ""),
  } as Settlement
  for (const k of SETTLEMENT_INT_COLS) out[k] = toInt(r[k])
  for (const k of SETTLEMENT_TEXT_COLS) out[k] = typeof r[k] === "string" ? (r[k] as string) : null
  return out
}

/**
 * What an Approve & pay answer means for the operator:
 *   paid       200: paid out (or closed at 0 €)
 *   adopted    200 with adopted_payout: Stripe had already paid this settlement
 *              out (an earlier attempt); it is now recorded
 *   submitted  500 record_failed: Stripe accepted the call but recording it
 *              failed; the settlement stays `processing` until order-worker
 *              reconciles it with Stripe. Not a failure, nothing to retry.
 *   error      anything else
 */
export type PayOutcome = "paid" | "adopted" | "submitted" | "error"

export function payOutcome(status: number, body: Record<string, unknown>): PayOutcome {
  if (status >= 200 && status < 300) return body.adopted_payout === true ? "adopted" : "paid"
  if (body.error === "record_failed") return "submitted"
  return "error"
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

const euro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 18000 → "180,00 €" (always it-IT, like every BirraOra money figure). */
export function formatEuroCents(cents: number): string {
  return euro.format(cents / 100)
}

/** 1550 → "15,5 %"-style percent for display (it-IT). */
export function formatRateBps(bps: number): string {
  return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(bps / 100)} %`
}

export type CapState = "none" | "ok" | "near" | "reached"

/** Where a restaurant stands against its monthly cap: no cap, under 80 %, ≥ 80 %, reached. */
export function capProgress(feeCents: number, capCents: number | null, capReachedAt?: string | null): { state: CapState; ratio: number } {
  if (capCents === null) return { state: "none", ratio: 0 }
  if (capReachedAt || feeCents >= capCents) return { state: "reached", ratio: 1 }
  const ratio = capCents > 0 ? Math.min(1, Math.max(0, feeCents / capCents)) : 1
  // ≥ 80 % in integer maths: fee * 5 >= cap * 4.
  return { state: feeCents * 5 >= capCents * 4 ? "near" : "ok", ratio }
}

// ---------------------------------------------------------------------------
// Settlement statement (settlement_statement(p_id) → jsonb)
// ---------------------------------------------------------------------------

/**
 * commission_entries.kind:
 *   fee             one per counted order
 *   reversal        a refunded / lost-dispute card order (negative)
 *   waiver          an operator-waived cash order (negative fee, no money moved)
 *   cap_adjustment  cap room re-charged to a capped order after a reversal /
 *                   waiver: amount, base, card and full fee are 0, only fee_cents
 *                   (> 0) counts. Not an order.
 */
export const LEDGER_KINDS = ["fee", "reversal", "waiver", "cap_adjustment"] as const
export type LedgerKind = (typeof LEDGER_KINDS)[number]

/** An unknown kind is shown as a fee, as before (the database allows only these four). */
export function ledgerKind(v: unknown): LedgerKind {
  return (LEDGER_KINDS as readonly unknown[]).includes(v) ? (v as LedgerKind) : "fee"
}

export type LedgerKindLabels = Record<LedgerKind, string>

export interface StatementLine {
  order_number: string
  occurred_at: string
  kind: LedgerKind
  method: "card" | "cash"
  /** Order total (negative on a refund). */
  amount_cents: number
  /** Products subtotal after offers: the commission base. */
  base_cents: number
  /** Card money collected for this line (negative on a refund, 0 for cash). */
  card_cents: number
  rate_bps: number
  /** Commission before the cap. */
  full_fee_cents: number
  /** Commission actually taken (less than full_fee_cents when the cap cut it). */
  fee_cents: number
  stripe_fee_cents: number
}

export interface Statement {
  settlement: Settlement
  business: {
    business_id: string
    name: string
    tax_id: string | null
    address: string | null
    email: string | null
    order_email: string | null
    slug: string | null
  }
  settings: { rate_bps: number; monthly_cap_cents: number | null }
  month: { fee_cents: number; cap_reached_at: string | null }
  lines: StatementLine[]
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

export function normaliseStatementLine(r: Record<string, unknown>): StatementLine {
  return {
    order_number: r.order_number === null || r.order_number === undefined ? "" : String(r.order_number),
    occurred_at: String(r.occurred_at ?? ""),
    kind: ledgerKind(r.kind),
    method: r.method === "cash" ? "cash" : "card",
    amount_cents: toInt(r.amount_cents),
    base_cents: toInt(r.base_cents),
    card_cents: toInt(r.card_cents),
    rate_bps: toInt(r.rate_bps),
    full_fee_cents: toInt(r.full_fee_cents),
    fee_cents: toInt(r.fee_cents),
    stripe_fee_cents: toInt(r.stripe_fee_cents),
  }
}

/** The jsonb from settlement_statement, with bigints as numbers; null when there is none. */
export function normaliseStatement(raw: unknown): Statement | null {
  if (!raw || typeof raw !== "object") return null
  const j = raw as Record<string, unknown>
  const b = obj(j.business)
  const settings = obj(j.settings)
  const month = obj(j.month)
  const name = str(b.name)
  return {
    settlement: normaliseSettlement(obj(j.settlement), { business_name: name, slug: b.slug }),
    business: {
      business_id: String(b.business_id ?? ""),
      name: name ?? "",
      tax_id: str(b.tax_id),
      address: str(b.address),
      email: str(b.email),
      order_email: str(b.order_email),
      slug: str(b.slug),
    },
    settings: { rate_bps: toInt(settings.rate_bps), monthly_cap_cents: toIntOrNull(settings.monthly_cap_cents) },
    month: { fee_cents: toInt(month.fee_cents), cap_reached_at: str(month.cap_reached_at) },
    lines: Array.isArray(j.lines) ? (j.lines as unknown[]).map((l) => normaliseStatementLine(obj(l))) : [],
  }
}

/** True when the monthly cap cut this order line's commission (only a fee line can be capped). */
export function isCapped(l: Pick<StatementLine, "kind" | "fee_cents" | "full_fee_cents">): boolean {
  return l.kind === "fee" && l.fee_cents !== l.full_fee_cents
}

const romeDay = new Intl.DateTimeFormat("it-IT", { timeZone: ROME_TZ, day: "2-digit", month: "2-digit", year: "numeric" })
const romeDayTime = new Intl.DateTimeFormat("it-IT", {
  timeZone: ROME_TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

/** "dd/mm/yyyy" in Rome. */
export function formatRomeDate(iso: string): string {
  return romeDay.format(new Date(iso))
}

/** "dd/mm/yyyy, HH:mm" in Rome. */
export function formatRomeDateTime(iso: string): string {
  return romeDayTime.format(new Date(iso))
}

/** A settlement's period as Rome dates: period_end is exclusive, so the last day shown is the day before it. */
export function settlementPeriod(s: Pick<Settlement, "period_start" | "period_end">): { first: string; last: string } {
  return { first: formatRomeDate(s.period_start), last: formatRomeDate(new Date(Date.parse(s.period_end) - 1).toISOString()) }
}

/** Cents as a CSV decimal with a comma and no thousands separator: -1234 → "-12,34". */
export function centsToCsv(cents: number): string {
  const sign = cents < 0 ? "-" : ""
  const a = Math.abs(cents)
  return `${sign}${Math.trunc(a / 100)},${String(a % 100).padStart(2, "0")}`
}

function csvCell(v: string): string {
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export interface StatementCsvLabels {
  order: string
  date: string
  type: string
  method: string
  total: string
  subtotal: string
  rate: string
  commission: string
  capped: string
  stripeFee: string
  card: string
  kinds: LedgerKindLabels
  methods: { card: string; cash: string }
  yes: string
}

/** The statement's order lines as an Italian-Excel CSV: `;` separated, comma decimals, CRLF lines. */
export function statementCsv(lines: StatementLine[], l: StatementCsvLabels): string {
  const head = [l.order, l.date, l.type, l.method, l.total, l.subtotal, l.rate, l.commission, l.capped, l.stripeFee, l.card]
  const rows = lines.map((x) => [
    x.order_number,
    formatRomeDateTime(x.occurred_at),
    l.kinds[x.kind],
    l.methods[x.method],
    centsToCsv(x.amount_cents),
    centsToCsv(x.base_cents),
    centsToCsv(x.rate_bps), // basis points / 100 = percent, same two-decimal shape
    centsToCsv(x.fee_cents),
    isCapped(x) ? l.yes : "",
    centsToCsv(x.stripe_fee_cents),
    centsToCsv(x.card_cents),
  ])
  return [head, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n"
}

/** The commission rate the statement's orders were charged at: the one line rate, else the restaurant's current rate. */
export function statementRate(st: Pick<Statement, "lines" | "settings">): number {
  const rates = new Set(st.lines.filter((l) => l.kind === "fee").map((l) => l.rate_bps))
  return rates.size === 1 ? [...rates][0] : st.settings.rate_bps
}

export interface StatementTotals {
  amount_cents: number
  base_cents: number
  fee_cents: number
  stripe_fee_cents: number
  card_cents: number
}

export function statementTotals(lines: StatementLine[]): StatementTotals {
  const t: StatementTotals = { amount_cents: 0, base_cents: 0, fee_cents: 0, stripe_fee_cents: 0, card_cents: 0 }
  for (const l of lines) for (const k of Object.keys(t) as (keyof StatementTotals)[]) t[k] += l[k]
  return t
}

/** "2026-11-16": the Rome calendar date of an instant, for file names. */
export function romeIsoDate(iso: string): string {
  return formatLocalDate(romeToday(new Date(iso)))
}

// ---------------------------------------------------------------------------
// One restaurant's orders in a period (console /finance/businesses/[id])
// ---------------------------------------------------------------------------

/** IVA on BirraOra's commission, as public.commission_vat_bps(). */
export const COMMISSION_VAT_BPS = 2200

/** round(fee × IVA), half away from zero like Postgres round() on numeric. */
export function vatOn(feeCents: number, vatBps: number = COMMISSION_VAT_BPS): number {
  const x = (Math.abs(feeCents) * vatBps) / 10_000
  return Math.sign(feeCents) * Math.round(x)
}

/** Case- and accent-insensitive "contains", for the restaurant name filter. */
export function nameMatches(name: string, query: string): boolean {
  const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
  const q = fold(query)
  return q === "" || fold(name).includes(q)
}

/** One ledger entry of the restaurant, with the same money columns as the overview. */
export interface BusinessOrderLine {
  /** commission_entries.id (an order can have several cap_adjustment lines). */
  entry_id: string
  order_id: string
  order_number: string
  occurred_at: string
  kind: LedgerKind
  method: "card" | "cash"
  /** Order total (0 on a refund line: refunds have their own column). */
  gross_cents: number
  cash_cents: number
  card_cents: number
  refund_cents: number
  base_cents: number
  rate_bps: number
  full_fee_cents: number
  fee_cents: number
  vat_cents: number
  /** Stripe's card fee; null while order-worker hasn't read it from Stripe yet. */
  stripe_fee_cents: number | null
  /** Card money − commission − IVA − Stripe fee for this line. */
  net_cents: number
  /** Cash fee line: an operator can waive it (no waiver recorded for the order yet). */
  waivable: boolean
}

export interface LedgerEntryRow {
  id?: unknown
  order_id: unknown
  kind: unknown
  method: unknown
  occurred_at: unknown
  amount_cents: unknown
  base_cents: unknown
  card_cents: unknown
  rate_bps: unknown
  full_fee_cents: unknown
  fee_cents: unknown
}

/**
 * A commission_entries row → a display line. `stripeFee` is the card_fees
 * row's fee, if any; `waived` says whether the order already has a waiver.
 * Only a fee line is an order (counted, gross / cash / card money); a
 * reversal moves card money back (refunds); a waiver takes the cash order's
 * amount and fee back out (like the settlement's cash total); a cap
 * adjustment only adds commission.
 */
export function businessOrderLine(e: LedgerEntryRow, orderNumber: string | null, stripeFee: number | null, waived = false): BusinessOrderLine {
  const kind = ledgerKind(e.kind)
  const method = e.method === "cash" ? "cash" : "card"
  const amount = toInt(e.amount_cents)
  const cardMoney = toInt(e.card_cents)
  const fee = toInt(e.fee_cents)
  const vat = vatOn(fee)
  // Stripe keeps its fee on a refund; only a captured card order carries one.
  const sfee = kind === "fee" && method === "card" ? stripeFee : 0
  return {
    entry_id: String(e.id ?? ""),
    order_id: String(e.order_id ?? ""),
    order_number: orderNumber ?? "",
    occurred_at: String(e.occurred_at ?? ""),
    kind,
    method,
    // A waiver takes its cash order out of the cash total (negative amount),
    // as settlement_build_next sums cash: sum(amount_cents) where method = 'cash'.
    gross_cents: kind === "fee" || kind === "waiver" ? amount : 0,
    cash_cents: (kind === "fee" || kind === "waiver") && method === "cash" ? amount : 0,
    card_cents: kind === "fee" && method === "card" ? amount : 0,
    refund_cents: kind === "reversal" ? -cardMoney : 0,
    base_cents: toInt(e.base_cents),
    rate_bps: toInt(e.rate_bps),
    full_fee_cents: toInt(e.full_fee_cents),
    fee_cents: fee,
    vat_cents: vat,
    stripe_fee_cents: sfee,
    net_cents: cardMoney - fee - vat - (sfee ?? 0),
    waivable: kind === "fee" && method === "cash" && !waived,
  }
}

export interface BusinessDetailTotals {
  orders_count: number
  card_orders: number
  cash_orders: number
  gross_cents: number
  cash_cents: number
  card_cents: number
  refund_cents: number
  base_cents: number
  fee_cents: number
  /** IVA on the summed commission (as the overview), so it can differ by a cent from the line sum. */
  vat_cents: number
  stripe_fee_cents: number
  /** Card orders whose Stripe fee isn't known yet. */
  stripe_fee_pending: number
  net_cents: number
}

export function businessDetailTotals(lines: BusinessOrderLine[]): BusinessDetailTotals {
  const t: BusinessDetailTotals = {
    orders_count: 0,
    card_orders: 0,
    cash_orders: 0,
    gross_cents: 0,
    cash_cents: 0,
    card_cents: 0,
    refund_cents: 0,
    base_cents: 0,
    fee_cents: 0,
    vat_cents: 0,
    stripe_fee_cents: 0,
    stripe_fee_pending: 0,
    net_cents: 0,
  }
  // Σ(card money − commission − Stripe fee), before IVA on the total.
  let beforeVat = 0
  for (const l of lines) {
    if (l.kind === "fee") {
      t.orders_count++
      if (l.method === "card") t.card_orders++
      else t.cash_orders++
    }
    t.gross_cents += l.gross_cents
    t.cash_cents += l.cash_cents
    t.card_cents += l.card_cents
    t.refund_cents += l.refund_cents
    t.base_cents += l.base_cents
    t.fee_cents += l.fee_cents
    if (l.stripe_fee_cents === null) t.stripe_fee_pending++
    else t.stripe_fee_cents += l.stripe_fee_cents
    beforeVat += l.net_cents + l.vat_cents
  }
  t.vat_cents = vatOn(t.fee_cents)
  t.net_cents = beforeVat - t.vat_cents
  return t
}

export interface BusinessDetail {
  from: string
  to: string
  cap_month: string
  business: { business_id: string; business_name: string; slug: string }
  settings: { rate_bps: number; monthly_cap_cents: number | null }
  cap: { fee_cents: number; cap_reached_at: string | null }
  lines: BusinessOrderLine[]
}

export interface BusinessCsvLabels {
  order: string
  date: string
  type: string
  method: string
  gross: string
  cash: string
  card: string
  refunds: string
  base: string
  rate: string
  commission: string
  capped: string
  vat: string
  stripe: string
  net: string
  kinds: LedgerKindLabels
  methods: { card: string; cash: string }
  yes: string
  pending: string
  totals: string
}

/** A restaurant's order lines and their totals as an Italian-Excel CSV: `;` separated, comma decimals, CRLF lines. */
export function businessCsv(lines: BusinessOrderLine[], l: BusinessCsvLabels): string {
  const head = [l.order, l.date, l.type, l.method, l.gross, l.cash, l.card, l.refunds, l.base, l.rate, l.commission, l.capped, l.vat, l.stripe, l.net]
  const rows = lines.map((x) => [
    x.order_number,
    x.occurred_at ? formatRomeDateTime(x.occurred_at) : "",
    l.kinds[x.kind],
    l.methods[x.method],
    centsToCsv(x.gross_cents),
    centsToCsv(x.cash_cents),
    centsToCsv(x.card_cents),
    centsToCsv(x.refund_cents),
    centsToCsv(x.base_cents),
    centsToCsv(x.rate_bps), // basis points / 100 = percent
    centsToCsv(x.fee_cents),
    isCapped(x) ? l.yes : "",
    centsToCsv(x.vat_cents),
    x.stripe_fee_cents === null ? l.pending : centsToCsv(x.stripe_fee_cents),
    centsToCsv(x.net_cents),
  ])
  const t = businessDetailTotals(lines)
  const total = [
    l.totals, "", "", "",
    centsToCsv(t.gross_cents), centsToCsv(t.cash_cents), centsToCsv(t.card_cents), centsToCsv(t.refund_cents),
    centsToCsv(t.base_cents), "", centsToCsv(t.fee_cents), "", centsToCsv(t.vat_cents), centsToCsv(t.stripe_fee_cents), centsToCsv(t.net_cents),
  ]
  return [head, ...rows, total].map((r) => r.map(csvCell).join(";")).join("\r\n") + "\r\n"
}

// ---------------------------------------------------------------------------
// BirraOra's platform Stripe balance (operator-stripe-balance)
// ---------------------------------------------------------------------------

export interface PlatformBalance {
  available_cents: number
  pending_cents: number
  /** Pending money by the (UTC) day it becomes available, soonest first. */
  upcoming: Array<{ date: string; amount_cents: number }>
  upcoming_partial: boolean
  as_of: string
}

export function normalisePlatformBalance(raw: Record<string, unknown>): PlatformBalance {
  const upcoming = Array.isArray(raw.upcoming) ? (raw.upcoming as unknown[]) : []
  return {
    available_cents: toInt(raw.available_cents),
    pending_cents: toInt(raw.pending_cents),
    upcoming: upcoming
      .map((u) => obj(u))
      .filter((u) => typeof u.date === "string" && DATE_RE.test(u.date))
      .map((u) => ({ date: u.date as string, amount_cents: toInt(u.amount_cents) })),
    upcoming_partial: raw.upcoming_partial === true,
    as_of: typeof raw.as_of === "string" ? raw.as_of : "",
  }
}
