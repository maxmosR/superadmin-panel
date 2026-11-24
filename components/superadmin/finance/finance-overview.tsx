"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight, Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n/client"
import { financeError } from "@/lib/finance-error"
import type { Messages } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import {
  CANCELLABLE_STATUSES,
  PAYABLE_STATUSES,
  ROME_TZ,
  capProgress,
  formatEuroCents,
  formatRateBps,
  nameMatches,
  overviewTotals,
  payOutcome,
  presetRange,
  type FinanceOverviewRow,
  type Settlement,
  type SettlementStatus,
} from "@/lib/finance"
import { ConsoleShell, PageHead } from "../console-shell"
import { useConfirm } from "../confirm-dialog"
import { Field } from "../field"
import { PeriodPicker, Stat } from "./period-picker"
import { StripeBalanceCard } from "./stripe-balance"

type StatusFilter = SettlementStatus | "all"
const FILTERS: StatusFilter[] = ["pending_approval", "approved", "processing", "failed", "paid", "cancelled", "all"]

// Everything money for the operator: what each restaurant took and owes in a
// period, and the weekly settlements waiting for approval.
export function FinanceOverview({
  adminEmail = null,
  initialRange = null,
}: {
  adminEmail?: string | null
  /** From /finance?from=…&to=… (already validated), else this month. */
  initialRange?: { from: string; to: string } | null
}) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])

  const initial = useMemo(() => initialRange ?? presetRange("thisMonth"), [initialRange])
  const [applied, setApplied] = useState(initial)
  const [query, setQuery] = useState("")

  const [rows, setRows] = useState<FinanceOverviewRow[]>([])
  const [capMonth, setCapMonth] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [filter, setFilter] = useState<StatusFilter>("pending_approval")
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [sLoading, setSLoading] = useState(true)
  const [sError, setSError] = useState("")
  const [notice, setNotice] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<Settlement | null>(null)
  const [balanceKey, setBalanceKey] = useState(0)

  const { confirm, dialog } = useConfirm()

  const loadOverview = useCallback(async (range: { from: string; to: string }) => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/finance/overview?from=${range.from}&to=${range.to}`, { cache: "no-store" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(financeError(tRef.current, j, res.status))
        setRows([])
        return
      }
      setRows(j.businesses ?? [])
      setCapMonth(j.cap_month ?? null)
    } catch {
      setError(tRef.current.common.network)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSettlements = useCallback(async (status: StatusFilter) => {
    setSLoading(true)
    try {
      const res = await fetch(`/api/finance/settlements?status=${status}`, { cache: "no-store" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSError(financeError(tRef.current, j, res.status))
        setSettlements([])
        return
      }
      setSettlements(j.settlements ?? [])
    } catch {
      setSError(tRef.current.common.network)
    } finally {
      setSLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadOverview(applied)
    // Keep the period in the address, so Back from a restaurant returns to it.
    window.history.replaceState(null, "", `/finance?from=${applied.from}&to=${applied.to}`)
  }, [applied, loadOverview])

  useEffect(() => {
    void loadSettlements(filter)
  }, [filter, loadSettlements])

  const dateFmt = useMemo(() => new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: ROME_TZ }), [])
  const monthFmt = useMemo(() => new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" }), [])
  const dateTimeFmt = useMemo(
    () => new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ROME_TZ }),
    [],
  )
  const period = (s: Settlement) => {
    // period_end is exclusive: show the last day inside it.
    const end = new Date(new Date(s.period_end).getTime() - 1)
    return `${dateFmt.format(new Date(s.period_start))} – ${dateFmt.format(end)}`
  }
  const nameOf = (s: Settlement) => s.business_name ?? s.slug ?? s.business_id

  const afterAction = (message: string) => {
    setNotice(message)
    setBalanceKey((k) => k + 1)
    void loadSettlements(filter)
    void loadOverview(applied)
  }

  const pay = async (s: Settlement) => {
    const amount = formatEuroCents(s.payout_cents)
    const name = nameOf(s)
    const ok = await confirm({
      title: fmt(t.finance.settlements.payConfirm.title, { amount, name }),
      description: (
        <>
          <p>{fmt(t.finance.settlements.payConfirm.body, { amount, period: period(s) })}</p>
          <PayBreakdown s={s} t={t} fmt={fmt} />
          {s.payout_cents === 0 && <p>{t.finance.settlements.payConfirm.zero}</p>}
          {s.deficit_cents > 0 && <p>{fmt(t.finance.settlements.payConfirm.deficit, { amount: formatEuroCents(s.deficit_cents) })}</p>}
          <p>{t.finance.settlements.payConfirm.email}</p>
        </>
      ),
      confirmLabel: t.finance.settlements.payConfirm.confirm,
    })
    if (!ok) return
    setBusyId(s.id)
    setSError("")
    setNotice("")
    try {
      const res = await fetch("/api/finance/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pay", settlement_id: s.id, expected_version: s.version }),
      })
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const outcome = payOutcome(res.status, j)
      if (outcome === "error") {
        setSError(financeError(t, j, res.status))
        if (res.status === 409) void loadSettlements(filter)
        return
      }
      const s2 = t.finance.settlements
      afterAction(fmt(outcome === "adopted" ? s2.paidAdopted : outcome === "submitted" ? s2.submitted : s2.paid, { name }))
    } catch {
      setSError(t.common.network)
    } finally {
      setBusyId(null)
    }
  }

  const cancel = async (s: Settlement, reason: string): Promise<string | null> => {
    setBusyId(s.id)
    setSError("")
    setNotice("")
    try {
      const res = await fetch("/api/finance/settlements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", settlement_id: s.id, expected_version: s.version, reason }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 409) void loadSettlements(filter)
        return financeError(t, j, res.status)
      }
      afterAction(fmt(t.finance.settlements.cancelled, { name: nameOf(s) }))
      return null
    } catch {
      return t.common.network
    } finally {
      setBusyId(null)
    }
  }

  const shownRows = rows.filter((r) => nameMatches(r.business_name, query) || nameMatches(r.slug, query))
  const totals = overviewTotals(shownRows)
  const detailHref = (id: string) => `/finance/businesses/${id}?from=${applied.from}&to=${applied.to}`
  const inFlight = busyId !== null

  return (
    <ConsoleShell adminEmail={adminEmail}>
      <PageHead title={t.finance.title} description={t.finance.description} />

      {/* BirraOra's Stripe balance vs what the waiting settlements need (all restaurants, any period) */}
      <StripeBalanceCard
        reloadKey={balanceKey}
        awaitingCents={loading && rows.length === 0 ? null : rows.reduce((n, r) => n + r.pending_payout_cents, 0)}
        awaitingCount={rows.reduce((n, r) => n + r.pending_settlements, 0)}
      />

      {/* Period */}
      <PeriodPicker applied={applied} onApply={setApplied} />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Totals of the restaurants shown */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label={t.finance.overview.summary.orders} value={loading ? "—" : String(totals.orders_count)} />
        <Stat label={t.finance.overview.summary.gross} value={loading ? "—" : formatEuroCents(totals.gross_cents)} />
        <Stat label={t.finance.overview.summary.commission} value={loading ? "—" : formatEuroCents(totals.fee_cents)} />
        <Stat label={t.finance.overview.summary.vat} value={loading ? "—" : formatEuroCents(totals.vat_cents)} />
        <Stat label={t.finance.overview.summary.stripe} value={loading ? "—" : formatEuroCents(totals.stripe_fee_cents)} hint={t.finance.overview.feesPendingNote} />
        <Stat
          label={t.finance.overview.summary.net}
          value={loading ? "—" : formatEuroCents(totals.net_cents)}
          tone={!loading && totals.net_cents < 0 ? "bad" : undefined}
        />
      </div>

      {/* Per-restaurant overview */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? t.finance.overview.loading : `${t.finance.overview.count(rows.length)} · ${dateFmt.format(new Date(`${applied.from}T12:00:00Z`))} – ${dateFmt.format(new Date(`${applied.to}T12:00:00Z`))}`}
          </CardTitle>
          {capMonth && !loading && (
            <CardDescription>{fmt(t.finance.overview.capMonth, { month: monthFmt.format(new Date(`${capMonth}T00:00:00Z`)) })}</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {!loading && rows.length > 0 && (
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="w-72">
                <Field label={t.finance.overview.search}>
                  {(p) => (
                    <div className="relative">
                      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                      <Input {...p} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.finance.overview.searchPlaceholder} className="pl-8" />
                    </div>
                  )}
                </Field>
              </div>
              {query.trim() && (
                <p className="pb-2 text-xs text-muted-foreground" aria-live="polite">
                  {fmt(t.finance.overview.shown, { n: shownRows.length, total: rows.length })}
                </p>
              )}
            </div>
          )}
          {loading ? (
            <Spinner label={t.finance.overview.loading} />
          ) : rows.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">{t.finance.overview.empty}</p>
          ) : shownRows.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">{fmt(t.finance.overview.noMatch, { q: query.trim() })}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.finance.overview.cols.restaurant}</TableHead>
                    <TableHead className="text-right">{t.finance.overview.cols.orders}</TableHead>
                    <TableHead className="text-right">{t.finance.overview.cols.gross}</TableHead>
                    <TableHead className="text-right">{t.finance.overview.cols.cash}</TableHead>
                    <TableHead className="text-right">{t.finance.overview.cols.card}</TableHead>
                    <TableHead className="text-right">{t.finance.overview.cols.refunds}</TableHead>
                    <TableHead className="text-right">
                      <div>{t.finance.overview.cols.base}</div>
                      <div className="text-xs font-normal">{t.finance.overview.baseNote}</div>
                    </TableHead>
                    <TableHead className="text-right">
                      <div>{t.finance.overview.cols.commission}</div>
                      <div className="text-xs font-normal">{t.finance.overview.commissionNote}</div>
                    </TableHead>
                    <TableHead className="text-right">{t.finance.overview.cols.vat}</TableHead>
                    <TableHead className="text-right">{t.finance.overview.cols.stripe}</TableHead>
                    <TableHead className="min-w-48">{t.finance.overview.cols.cap}</TableHead>
                    <TableHead className="text-right" title={t.finance.overview.netNote}>
                      <div>{t.finance.overview.cols.net}</div>
                      <div className="text-xs font-normal">{t.finance.overview.netNote}</div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shownRows.map((r) => (
                    <TableRow
                      key={r.business_id}
                      className="cursor-pointer"
                      onClick={(e) => {
                        // Let a real link (or a modified click) do its own thing.
                        if ((e.target as HTMLElement).closest("a")) return
                        router.push(detailHref(r.business_id))
                      }}
                    >
                      <TableCell>
                        <Link
                          href={detailHref(r.business_id)}
                          className="inline-flex items-center gap-1 font-medium hover:underline"
                          aria-label={fmt(t.finance.overview.openDetail, { name: r.business_name })}
                        >
                          {r.business_name}
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {r.slug} · {fmt(t.finance.overview.rate, { rate: formatRateBps(r.rate_bps) })}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <div>{r.orders_count}</div>
                        <div className="text-xs text-muted-foreground">{fmt(t.finance.overview.ordersSplit, { card: r.card_orders, cash: r.cash_orders })}</div>
                      </TableCell>
                      <Money cents={r.gross_cents} />
                      <Money cents={r.cash_cents} />
                      <Money cents={r.card_cents} />
                      <Money cents={r.card_refunds_cents} quiet={r.card_refunds_cents === 0} />
                      <Money cents={r.base_cents} />
                      <Money cents={r.fee_cents} />
                      <Money cents={r.vat_cents} quiet={r.vat_cents === 0} />
                      <Money cents={r.stripe_fee_cents} quiet={r.stripe_fee_cents === 0} />
                      <TableCell>
                        <CapCell row={r} t={t} fmt={fmt} />
                      </TableCell>
                      <TableCell className="text-right">
                        <NetAmount cents={r.net_cents} t={t} />
                        {r.pending_settlements > 0 && (
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {fmt(t.finance.overview.pending, { n: r.pending_settlements, amount: formatEuroCents(r.pending_payout_cents) })}
                          </div>
                        )}
                        {r.open_deficit_cents > 0 && (
                          <div className="text-xs text-destructive tabular-nums">
                            {fmt(t.finance.overview.openDeficit, { amount: formatEuroCents(r.open_deficit_cents) })}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">{t.finance.overview.totals}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{totals.orders_count}</TableCell>
                    <Money cents={totals.gross_cents} strong />
                    <Money cents={totals.cash_cents} strong />
                    <Money cents={totals.card_cents} strong />
                    <Money cents={totals.card_refunds_cents} strong />
                    <Money cents={totals.base_cents} strong />
                    <Money cents={totals.fee_cents} strong />
                    <Money cents={totals.vat_cents} strong />
                    <Money cents={totals.stripe_fee_cents} strong />
                    <TableCell />
                    <TableCell className="text-right font-semibold">
                      <NetAmount cents={totals.net_cents} t={t} />
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settlements */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.finance.settlements.title}</CardTitle>
          <CardDescription>{t.finance.settlements.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div role="group" aria-label={t.finance.settlements.statusLabel} className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Button
                key={f}
                type="button"
                size="sm"
                variant={filter === f ? "secondary" : "ghost"}
                aria-pressed={filter === f}
                onClick={() => {
                  setNotice("")
                  setSError("")
                  setFilter(f)
                }}
              >
                {f === "all" ? t.finance.settlements.all : t.finance.settlements.status[f]}
              </Button>
            ))}
          </div>

          {sError && (
            <Alert variant="destructive">
              <AlertDescription>{sError}</AlertDescription>
            </Alert>
          )}
          {notice && (
            <p className="text-sm text-green-700" role="status">
              {notice}
            </p>
          )}

          {sLoading ? (
            <Spinner label={t.finance.settlements.loading} />
          ) : settlements.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">{t.finance.settlements.empty}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.finance.settlements.cols.period}</TableHead>
                    <TableHead>{t.finance.settlements.cols.restaurant}</TableHead>
                    <TableHead className="text-right">{t.finance.settlements.cols.cardNet}</TableHead>
                    <TableHead className="text-right">{t.finance.settlements.owed}</TableHead>
                    <TableHead className="text-right">{t.finance.settlements.cols.payout}</TableHead>
                    <TableHead className="text-right">{t.finance.settlements.cols.deficit}</TableHead>
                    <TableHead>{t.finance.settlements.cols.status}</TableHead>
                    <TableHead className="text-right">{t.finance.settlements.cols.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {settlements.map((s) => {
                    const busy = busyId === s.id
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          <Link href={`/finance/settlements/${s.id}`} className="font-medium hover:underline">
                            {period(s)}
                          </Link>
                          <div className="text-xs text-muted-foreground">{fmt(t.finance.settlements.orders, { n: s.orders_count })}</div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{nameOf(s)}</div>
                          {s.slug && <div className="text-xs text-muted-foreground">{s.slug}</div>}
                        </TableCell>
                        <Money cents={s.card_net_cents} />
                        <TableCell className="text-right tabular-nums">
                          <div>{formatEuroCents(s.owed_cents)}</div>
                          <div className="max-w-72 text-xs text-muted-foreground">
                            {fmt(t.finance.settlements.breakdown, {
                              fee: formatEuroCents(s.fee_cents),
                              vat: formatEuroCents(s.vat_cents),
                              stripe: formatEuroCents(s.stripe_fee_cents),
                              carry: formatEuroCents(s.carry_in_cents),
                              owed: formatEuroCents(s.owed_cents),
                            })}
                          </div>
                          <div className="text-xs whitespace-nowrap text-muted-foreground">
                            {fmt(t.finance.settlements.feesSplit, { card: formatEuroCents(s.fee_card_cents), cash: formatEuroCents(s.fee_cash_cents) })}
                          </div>
                        </TableCell>
                        <Money cents={s.payout_cents} strong />
                        <TableCell className={cn("text-right tabular-nums", s.deficit_cents > 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
                          {formatEuroCents(s.deficit_cents)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={s.status} t={t} />
                          {s.status === "processing" && (
                            <div className="mt-1 max-w-56 text-xs text-muted-foreground">
                              {t.finance.settlements.confirming}
                              {s.reconciled_at && <> · {fmt(t.finance.settlements.lastChecked, { time: dateTimeFmt.format(new Date(s.reconciled_at)) })}</>}
                            </div>
                          )}
                          {s.failure_reason && s.status === "failed" && (
                            <div className="mt-1 max-w-56 text-xs text-destructive">{fmt(t.finance.settlements.failure, { reason: s.failure_reason })}</div>
                          )}
                          {s.status === "failed" && s.stripe_payout_id && (
                            <div className="max-w-56 font-mono text-xs break-all text-muted-foreground">{fmt(t.finance.settlements.failedPayout, { id: s.stripe_payout_id })}</div>
                          )}
                          {s.payment_started_at && s.status !== "pending_approval" && s.status !== "cancelled" && (
                            <div className="mt-1 max-w-56 text-xs text-muted-foreground">
                              {fmt(t.finance.settlements.startedBy, {
                                who: s.payment_started_by_email ?? t.finance.settlements.startedByUnknown,
                                time: dateTimeFmt.format(new Date(s.payment_started_at)),
                              })}
                            </div>
                          )}
                          {s.cancel_reason && s.status === "cancelled" && (
                            <div className="mt-1 max-w-56 text-xs text-muted-foreground">{fmt(t.finance.settlements.cancelReasonShown, { reason: s.cancel_reason })}</div>
                          )}
                          {s.payout_attempt > 1 && <div className="text-xs text-muted-foreground">{fmt(t.finance.settlements.attempt, { n: s.payout_attempt })}</div>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button asChild size="sm" variant="ghost">
                              <Link href={`/finance/settlements/${s.id}`}>{t.finance.settlements.statementLink}</Link>
                            </Button>
                            {CANCELLABLE_STATUSES.includes(s.status) && (
                              <Button size="sm" variant="ghost" disabled={inFlight} onClick={() => setCancelling(s)}>
                                {t.finance.settlements.cancel}
                              </Button>
                            )}
                            {PAYABLE_STATUSES.includes(s.status) && (
                              <Button size="sm" variant="outline" disabled={inFlight} onClick={() => void pay(s)}>
                                {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                                {busy ? t.finance.settlements.paying : t.finance.settlements.pay}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {dialog}
      <CancelDialog
        settlement={cancelling}
        name={cancelling ? nameOf(cancelling) : ""}
        period={cancelling ? period(cancelling) : ""}
        busy={inFlight}
        onClose={() => setCancelling(null)}
        onConfirm={async (reason) => {
          if (!cancelling) return null
          const err = await cancel(cancelling, reason)
          if (!err) setCancelling(null)
          return err
        }}
      />
    </ConsoleShell>
  )
}

type Fmt = (s: string, v: Record<string, string | number>) => string

/** The payout sum, line by line, for the Approve & pay dialog. */
function PayBreakdown({ s, t, fmt }: { s: Settlement; t: Messages; fmt: Fmt }) {
  const c = t.finance.settlements.payConfirm
  const lines: Array<[string, number, boolean?]> = [
    [c.cardNet, s.card_net_cents],
    [fmt(c.commission, { base: formatEuroCents(s.base_cents) }), -s.fee_cents],
    [fmt(c.vat, { rate: formatRateBps(s.vat_bps) }), -s.vat_cents],
    [c.stripe, -s.stripe_fee_cents],
    [c.carry, -s.carry_in_cents],
    [c.payout, s.payout_cents, true],
  ]
  return (
    <div>
      <p className="font-medium text-foreground">{c.breakdownTitle}</p>
      <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm">
        {lines.map(([label, cents, total]) => (
          <div key={label} className={cn("contents", total && "font-semibold text-foreground")}>
            <dt className={cn(total && "border-t pt-1")}>{label}</dt>
            <dd className={cn("text-right tabular-nums", total && "border-t pt-1")}>{formatEuroCents(cents)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-10 text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
      {label}
    </div>
  )
}

function Money({ cents, strong, quiet }: { cents: number; strong?: boolean; quiet?: boolean }) {
  return (
    <TableCell className={cn("text-right whitespace-nowrap tabular-nums", strong && "font-semibold", quiet && "text-muted-foreground")}>
      {formatEuroCents(cents)}
    </TableCell>
  )
}

function NetAmount({ cents, t }: { cents: number; t: Messages }) {
  const deficit = cents < 0
  return (
    <div className={cn("whitespace-nowrap tabular-nums", deficit && "font-semibold text-destructive")}>
      <div>{formatEuroCents(cents)}</div>
      <div className={cn("text-xs font-normal", deficit ? "text-destructive" : "text-muted-foreground")}>
        {deficit ? t.finance.overview.deficit : t.finance.overview.owedToRestaurant}
      </div>
    </div>
  )
}

function CapCell({ row, t, fmt }: { row: FinanceOverviewRow; t: Messages; fmt: Fmt }) {
  const { state, ratio } = capProgress(row.cap_month_fee_cents, row.monthly_cap_cents, row.cap_reached_at)
  if (state === "none") {
    return (
      <div className="space-y-1">
        <div className="text-sm tabular-nums">{fmt(t.finance.overview.noCapFee, { fee: formatEuroCents(row.cap_month_fee_cents) })}</div>
        <Badge variant="secondary">{t.finance.overview.capBadges.none}</Badge>
      </div>
    )
  }
  const pct = Math.round(ratio * 100)
  return (
    <div className="space-y-1">
      <div className="text-sm whitespace-nowrap tabular-nums">
        {fmt(t.finance.overview.capOf, { fee: formatEuroCents(row.cap_month_fee_cents), cap: formatEuroCents(row.monthly_cap_cents ?? 0) })}
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={t.finance.overview.cols.cap}
      >
        <div
          className={cn("h-full rounded-full", state === "reached" ? "bg-green-600" : state === "near" ? "bg-amber-600" : "bg-muted-foreground/50")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {state === "reached" ? (
        <Badge variant="outline" className="border-green-600/40 text-green-700">
          {t.finance.overview.capBadges.reached}
        </Badge>
      ) : state === "near" ? (
        <Badge variant="outline" className="border-amber-600/40 text-amber-700">
          {t.finance.overview.capBadges.near}
        </Badge>
      ) : null}
    </div>
  )
}

function StatusBadge({ status, t }: { status: SettlementStatus; t: Messages }) {
  const label = t.finance.settlements.status[status]
  switch (status) {
    case "pending_approval":
      return (
        <Badge variant="outline" className="border-amber-600/40 bg-amber-50 text-amber-700">
          {label}
        </Badge>
      )
    case "failed":
      return <Badge variant="destructive">{label}</Badge>
    case "paid":
      return (
        <Badge variant="outline" className="border-green-600/40 text-green-700">
          {label}
        </Badge>
      )
    default:
      return <Badge variant="secondary">{label}</Badge>
  }
}

function CancelDialog({
  settlement,
  name,
  period,
  busy,
  onClose,
  onConfirm,
}: {
  settlement: Settlement | null
  name: string
  period: string
  busy: boolean
  onClose: () => void
  onConfirm: (reason: string) => Promise<string | null>
}) {
  const { t, fmt } = useI18n()
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  const [openedFor, setOpenedFor] = useState<string | null>(null)

  // Fresh form each time it opens for a settlement.
  if ((settlement?.id ?? null) !== openedFor) {
    setOpenedFor(settlement?.id ?? null)
    setReason("")
    setError("")
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const r = reason.trim()
    if (!r || r.length > 500) {
      setError(t.finance.errors.invalid_reason)
      return
    }
    setError("")
    const err = await onConfirm(r)
    if (err) setError(err)
  }

  return (
    <Dialog open={!!settlement} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{fmt(t.finance.settlements.cancelDialog.title, { name })}</DialogTitle>
            <DialogDescription>
              {period} · {t.finance.settlements.cancelDialog.body}
            </DialogDescription>
          </DialogHeader>
          <Field label={t.finance.settlements.cancelDialog.reason} hint={t.finance.settlements.cancelDialog.reasonHint} error={error || undefined}>
            {(p) => (
              <textarea
                {...p}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                disabled={busy}
                placeholder={t.finance.settlements.cancelDialog.reasonPlaceholder}
                className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm"
              />
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t.finance.settlements.cancelDialog.back}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              {busy ? t.finance.settlements.cancelling : t.finance.settlements.cancelDialog.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

