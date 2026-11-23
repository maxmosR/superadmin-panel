"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Download, Loader2, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useI18n } from "@/lib/i18n/client"
import { financeError } from "@/lib/finance-error"
import { cn } from "@/lib/utils"
import {
  capProgress,
  formatEuroCents,
  formatRateBps,
  formatRomeDateTime,
  isCapped,
  romeIsoDate,
  settlementPeriod,
  statementCsv,
  statementRate,
  statementTotals,
  type Statement,
} from "@/lib/finance"
import { ConsoleShell } from "../console-shell"

// One settlement's statement, the same content the restaurant receives by
// email when its payout is submitted. Printable (the console chrome hides in
// print) and downloadable as CSV for Italian spreadsheets.
export function SettlementStatementView({ settlementId, adminEmail = null }: { settlementId: string; adminEmail?: string | null }) {
  const { t, fmt } = useI18n()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const [st, setSt] = useState<Statement | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/finance/settlements/statement?id=${settlementId}`, { cache: "no-store" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(financeError(tRef.current, j, res.status))
        return
      }
      setSt(j as Statement)
      setError("")
    } catch {
      setError(tRef.current.common.network)
    } finally {
      setLoading(false)
    }
  }, [settlementId])

  useEffect(() => {
    void load()
  }, [load])

  const s = t.finance.statement

  const downloadCsv = () => {
    if (!st) return
    const csv = statementCsv(st.lines, { ...s.cols, kinds: s.kinds, methods: s.methods, yes: s.yes })
    // BOM so Excel reads the file as UTF-8.
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fmt(s.csvName, { slug: st.business.slug ?? "ristorante", date: romeIsoDate(st.settlement.period_start) })
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <ConsoleShell adminEmail={adminEmail}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/finance">{s.back}</Link>
        </Button>
        {st && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadCsv}>
              <Download className="h-4 w-4" aria-hidden />
              {s.csv}
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden />
              {s.print}
            </Button>
          </div>
        )}
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
          {s.loading}
        </div>
      ) : st ? (
        <StatementBody st={st} />
      ) : null}
    </ConsoleShell>
  )
}

function StatementBody({ st }: { st: Statement }) {
  const { t, fmt } = useI18n()
  const s = t.finance.statement
  const set = st.settlement
  const { first, last } = settlementPeriod(set)
  const rate = formatRateBps(statementRate(st))
  const cap = st.settings.monthly_cap_cents
  const totals = statementTotals(st.lines)
  const capState = capProgress(st.month.fee_cents, cap, st.month.cap_reached_at)

  const summary: Array<{ label: string; cents: number; strong?: boolean; danger?: boolean; rule?: boolean }> = [
    { label: s.rows.cardGross, cents: set.card_gross_cents },
    { label: s.rows.refunds, cents: -set.card_refunds_cents },
    { label: s.rows.cardNet, cents: set.card_net_cents, strong: true, rule: true },
    {
      label:
        cap === null
          ? fmt(s.rows.commission, { rate, base: formatEuroCents(set.base_cents) })
          : fmt(s.rows.commissionCap, { rate, base: formatEuroCents(set.base_cents), cap: formatEuroCents(cap) }),
      cents: -set.fee_cents,
    },
    { label: fmt(s.rows.vat, { rate: formatRateBps(set.vat_bps) }), cents: -set.vat_cents },
    { label: s.rows.stripe, cents: -set.stripe_fee_cents },
    { label: s.rows.carry, cents: -set.carry_in_cents },
    { label: s.rows.payout, cents: set.payout_cents, strong: true, rule: true },
    ...(set.deficit_cents > 0 ? [{ label: s.rows.deficit, cents: set.deficit_cents, strong: true, danger: true }] : []),
  ]

  return (
    <article className="space-y-6 print:space-y-4 print:text-[12px]">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{fmt(s.heading, { first, last })}</h1>
        <p className="text-base font-semibold">{st.business.name}</p>
        <p className="text-sm text-muted-foreground">{st.business.tax_id ? fmt(s.taxId, { id: st.business.tax_id }) : s.noTaxId}</p>
        {st.business.address && <p className="text-sm text-muted-foreground">{st.business.address}</p>}
        <p className="text-sm">{fmt(s.period, { first, last })}</p>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={set.status === "failed" ? "destructive" : "secondary"}>{fmt(s.status, { status: t.finance.settlements.status[set.status] })}</Badge>
          {set.paid_at && <span className="text-muted-foreground">{fmt(s.paidAt, { date: formatRomeDateTime(set.paid_at) })}</span>}
        </p>
        <p className="text-xs text-muted-foreground print:hidden">{s.emailed}</p>
      </header>

      <section className="rounded-xl border bg-card p-5 print:rounded-none print:border-0 print:p-0" aria-labelledby="statement-summary">
        <h2 id="statement-summary" className="mb-3 text-base font-semibold">
          {s.summary}
        </h2>
        <dl className="grid max-w-xl grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
          {summary.map((r) => (
            <div key={r.label} className="contents">
              <dt className={cn(r.rule && "border-t pt-1", r.strong && "font-semibold", r.danger && "text-destructive")}>{r.label}</dt>
              <dd className={cn("text-right tabular-nums", r.rule && "border-t pt-1", r.strong && "font-semibold", r.danger && "text-destructive")}>
                {formatEuroCents(r.cents)}
              </dd>
            </div>
          ))}
        </dl>
        {set.cash_orders > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">{fmt(s.rows.cash, { amount: formatEuroCents(set.cash_cents), n: set.cash_orders })}</p>
        )}
      </section>

      <section className="rounded-xl border bg-card p-5 print:rounded-none print:border-0 print:p-0" aria-labelledby="statement-cap">
        <h2 id="statement-cap" className="mb-2 text-base font-semibold">
          {s.cap.title}
        </h2>
        <p className="text-sm">
          {cap === null
            ? s.cap.none
            : capState.state === "reached" && st.month.cap_reached_at
              ? fmt(s.cap.reached, { date: formatRomeDateTime(st.month.cap_reached_at) })
              : fmt(s.cap.progress, { fee: formatEuroCents(st.month.fee_cents), cap: formatEuroCents(cap) })}
        </p>
      </section>

      <section className="rounded-xl border bg-card p-5 print:rounded-none print:border-0 print:p-0" aria-labelledby="statement-lines">
        <h2 id="statement-lines" className="mb-3 text-base font-semibold">
          {s.lines}
        </h2>
        {st.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{s.noLines}</p>
        ) : (
          <div className="overflow-x-auto print:overflow-visible">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{s.cols.order}</TableHead>
                  <TableHead>{s.cols.date}</TableHead>
                  <TableHead>{s.cols.type}</TableHead>
                  <TableHead>{s.cols.method}</TableHead>
                  <TableHead className="text-right">{s.cols.total}</TableHead>
                  <TableHead className="text-right">{s.cols.subtotal}</TableHead>
                  <TableHead className="text-right">{s.cols.commission}</TableHead>
                  <TableHead className="text-right">{s.cols.stripeFee}</TableHead>
                  <TableHead className="text-right">{s.cols.card}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {st.lines.map((l, i) => (
                  <TableRow key={`${l.order_number}-${l.kind}-${i}`}>
                    <TableCell className="font-mono text-xs">{l.order_number || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatRomeDateTime(l.occurred_at)}</TableCell>
                    <TableCell className={cn(l.kind === "reversal" && "text-destructive")}>{s.kinds[l.kind]}</TableCell>
                    <TableCell>{s.methods[l.method]}</TableCell>
                    <Cents cents={l.amount_cents} />
                    <Cents cents={l.base_cents} />
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {formatEuroCents(l.fee_cents)}
                      {isCapped(l) && (
                        <div className="text-xs text-amber-700" title={fmt(s.cappedNote, { full: formatEuroCents(l.full_fee_cents) })}>
                          {s.capped} · {formatEuroCents(l.full_fee_cents)}
                        </div>
                      )}
                    </TableCell>
                    <Cents cents={l.stripe_fee_cents} quiet={l.stripe_fee_cents === 0} />
                    <Cents cents={l.card_cents} quiet={l.card_cents === 0} />
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="font-semibold">
                    {s.totals}
                  </TableCell>
                  <Cents cents={totals.amount_cents} strong />
                  <Cents cents={totals.base_cents} strong />
                  <Cents cents={totals.fee_cents} strong />
                  <Cents cents={totals.stripe_fee_cents} strong />
                  <Cents cents={totals.card_cents} strong />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </section>
    </article>
  )
}

function Cents({ cents, strong, quiet }: { cents: number; strong?: boolean; quiet?: boolean }) {
  return (
    <TableCell className={cn("text-right whitespace-nowrap tabular-nums", strong && "font-semibold", quiet && "text-muted-foreground")}>
      {formatEuroCents(cents)}
    </TableCell>
  )
}

