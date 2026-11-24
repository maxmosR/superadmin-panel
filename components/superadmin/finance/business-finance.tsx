"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n/client"
import { financeError } from "@/lib/finance-error"
import { cn } from "@/lib/utils"
import {
  ROME_TZ,
  businessCsv,
  businessDetailTotals,
  capProgress,
  formatEuroCents,
  formatRateBps,
  formatRomeDateTime,
  isCapped,
  presetRange,
  type BusinessDetail,
  type BusinessOrderLine,
} from "@/lib/finance"
import { ConsoleShell, PageHead } from "../console-shell"
import { Field } from "../field"
import { PeriodPicker, Stat, type Range } from "./period-picker"

// One restaurant's money in a period, order by order: the same columns as the
// Finance overview row, one line per ledger entry (order, refund, waiver, cap
// adjustment). A cash order's commission can be waived from here (operator,
// with a reason): POST /api/finance/commission/waive.
export function BusinessFinanceView({
  businessId,
  adminEmail = null,
  initialRange = null,
}: {
  businessId: string
  adminEmail?: string | null
  initialRange?: Range | null
}) {
  const { t, fmt } = useI18n()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const b = t.finance.business

  const initial = useMemo(() => initialRange ?? presetRange("thisMonth"), [initialRange])
  const [applied, setApplied] = useState<Range>(initial)
  const [data, setData] = useState<BusinessDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [waiving, setWaiving] = useState<BusinessOrderLine | null>(null)
  const [waiveBusy, setWaiveBusy] = useState(false)

  const load = useCallback(
    async (range: Range) => {
      setLoading(true)
      setError("")
      try {
        const res = await fetch(`/api/finance/business?business_id=${businessId}&from=${range.from}&to=${range.to}`, { cache: "no-store" })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(financeError(tRef.current, j, res.status))
          setData(null)
          return
        }
        setData(j as BusinessDetail)
      } catch {
        setError(tRef.current.common.network)
      } finally {
        setLoading(false)
      }
    },
    [businessId],
  )

  useEffect(() => {
    void load(applied)
    window.history.replaceState(null, "", `/finance/businesses/${businessId}?from=${applied.from}&to=${applied.to}`)
  }, [applied, load, businessId])

  const dateFmt = useMemo(() => new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: ROME_TZ }), [])
  const monthFmt = useMemo(() => new Intl.DateTimeFormat("it-IT", { month: "long", year: "numeric", timeZone: "UTC" }), [])

  const lines = data?.lines ?? []
  const totals = businessDetailTotals(lines)
  const cap = data ? capProgress(data.cap.fee_cents, data.settings.monthly_cap_cents, data.cap.cap_reached_at) : null
  const dash = loading || !data

  const waive = async (line: BusinessOrderLine, reason: string): Promise<string | null> => {
    const w = t.finance.business.waive
    setWaiveBusy(true)
    setNotice("")
    try {
      const res = await fetch("/api/finance/commission/waive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, order_id: line.order_id, reason }),
      })
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        const code = typeof j.error === "string" ? j.error : ""
        return w.errors[code] ?? financeError(t, j, res.status)
      }
      const order = line.order_number || "—"
      const fee = formatEuroCents(typeof j.fee_cents_waived === "number" ? j.fee_cents_waived : 0)
      const adjusted = typeof j.cap_adjusted_cents === "number" ? j.cap_adjusted_cents : 0
      setNotice(
        j.result === "noop"
          ? fmt(w.noop, { order })
          : adjusted > 0
            ? fmt(w.doneAdjusted, { order, fee, adjusted: formatEuroCents(adjusted) })
            : fmt(w.done, { order, fee }),
      )
      setWaiving(null)
      void load(applied)
      return null
    } catch {
      return t.common.network
    } finally {
      setWaiveBusy(false)
    }
  }

  const downloadCsv = () => {
    if (!data) return
    const csv = businessCsv(data.lines, {
      ...b.cols,
      rate: b.csvCols.rate,
      capped: b.csvCols.capped,
      kinds: b.kinds,
      methods: b.methods,
      yes: b.yes,
      pending: b.pending,
      totals: b.totals,
    })
    // BOM so Excel reads the file as UTF-8.
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = fmt(b.csvName, { slug: data.business.slug || "ristorante", from: data.from, to: data.to })
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <ConsoleShell adminEmail={adminEmail}>
      <div className="mb-2">
        <Link href={`/finance?from=${applied.from}&to=${applied.to}`} className="text-sm text-muted-foreground hover:text-foreground">
          {b.back}
        </Link>
      </div>
      <PageHead
        title={data?.business.business_name || b.title}
        description={data ? `${data.business.slug} · ${fmt(b.rate, { rate: formatRateBps(data.settings.rate_bps) })}` : undefined}
        action={
          data ? (
            <div className="flex items-center gap-3">
              <Link href={`/businesses/${businessId}`} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
                {t.finance.overview.cols.restaurant} →
              </Link>
              <Button type="button" variant="outline" size="sm" onClick={downloadCsv} disabled={loading || data.lines.length === 0}>
                <Download className="h-4 w-4" aria-hidden />
                {b.csv}
              </Button>
            </div>
          ) : undefined
        }
      />

      <PeriodPicker applied={applied} onApply={setApplied} />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert className="mb-4">
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={b.orders}
          value={dash ? "—" : String(totals.orders_count)}
          sub={dash ? undefined : fmt(b.ordersSplit, { card: totals.card_orders, cash: totals.cash_orders })}
        />
        <Stat
          label={b.gross}
          value={dash ? "—" : formatEuroCents(totals.gross_cents)}
          sub={dash ? undefined : fmt(b.grossSplit, { card: formatEuroCents(totals.card_cents), cash: formatEuroCents(totals.cash_cents) })}
        />
        <Stat
          label={b.cap}
          value={
            dash || !cap
              ? "—"
              : cap.state === "none"
                ? t.finance.overview.capBadges.none
                : fmt(t.finance.overview.capOf, { fee: formatEuroCents(data.cap.fee_cents), cap: formatEuroCents(data.settings.monthly_cap_cents ?? 0) })
          }
          sub={
            dash || !cap ? undefined : (
              <CapSub
                state={cap.state}
                ratio={cap.ratio}
                month={fmt(b.capMonth, { month: monthFmt.format(new Date(`${data.cap_month}T00:00:00Z`)) })}
                fee={cap.state === "none" ? fmt(t.finance.overview.noCapFee, { fee: formatEuroCents(data.cap.fee_cents) }) : null}
                labels={t.finance.overview.capBadges}
                aria={b.cap}
              />
            )
          }
        />
        <Stat
          label={b.net}
          value={dash ? "—" : formatEuroCents(totals.net_cents)}
          tone={!dash && totals.net_cents < 0 ? "bad" : undefined}
          sub={
            dash ? undefined : (
              <>
                <div>{fmt(b.stripeLine, { amount: formatEuroCents(totals.stripe_fee_cents) })}</div>
                {totals.stripe_fee_pending > 0 && (
                  <div className="text-amber-700" title={b.pendingTitle}>
                    {fmt(b.stripePending, { n: totals.stripe_fee_pending })}
                  </div>
                )}
                {totals.net_cents < 0 && <div className="text-destructive">{t.finance.overview.deficit}</div>}
              </>
            )
          }
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading
              ? b.loading
              : `${b.lines(lines.length)} · ${dateFmt.format(new Date(`${applied.from}T12:00:00Z`))} – ${dateFmt.format(new Date(`${applied.to}T12:00:00Z`))}`}
          </CardTitle>
          <CardDescription>{t.finance.overview.netNote}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
              {b.loading}
            </div>
          ) : lines.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">{b.empty}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{b.cols.order}</TableHead>
                      <TableHead>{b.cols.date}</TableHead>
                      <TableHead>{b.cols.method}</TableHead>
                      <TableHead className="text-right">{b.cols.gross}</TableHead>
                      <TableHead className="text-right">{b.cols.cash}</TableHead>
                      <TableHead className="text-right">{b.cols.card}</TableHead>
                      <TableHead className="text-right">{b.cols.refunds}</TableHead>
                      <TableHead className="text-right">
                        <div>{b.cols.base}</div>
                        <div className="text-xs font-normal">{t.finance.overview.baseNote}</div>
                      </TableHead>
                      <TableHead className="text-right">{b.cols.commission}</TableHead>
                      <TableHead className="text-right">{b.cols.vat}</TableHead>
                      <TableHead className="text-right">{b.cols.stripe}</TableHead>
                      <TableHead className="text-right">{b.cols.net}</TableHead>
                      <TableHead>
                        <span className="sr-only">{b.waive.button}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l) => renderLine(l))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold" colSpan={3}>
                        {b.totals}
                      </TableCell>
                      <Money cents={totals.gross_cents} strong />
                      <Money cents={totals.cash_cents} strong />
                      <Money cents={totals.card_cents} strong />
                      <Money cents={totals.refund_cents} strong />
                      <Money cents={totals.base_cents} strong />
                      <Money cents={totals.fee_cents} strong />
                      <Money cents={totals.vat_cents} strong />
                      <Money cents={totals.stripe_fee_cents} strong />
                      <TableCell className={cn("text-right font-semibold whitespace-nowrap tabular-nums", totals.net_cents < 0 && "text-destructive")}>
                        {formatEuroCents(totals.net_cents)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">{b.vatNote}</p>
            </>
          )}
        </CardContent>
      </Card>

      <WaiveDialog line={waiving} busy={waiveBusy} onClose={() => setWaiving(null)} onConfirm={(reason) => (waiving ? waive(waiving, reason) : Promise.resolve(null))} />
    </ConsoleShell>
  )

  function renderLine(l: BusinessOrderLine) {
    const notOrder = l.kind !== "fee"
    const capped = isCapped(l)
    const title = l.kind === "waiver" || l.kind === "cap_adjustment" ? b.kindTitles[l.kind] : undefined
    return (
      <TableRow key={l.entry_id || `${l.order_id}:${l.kind}`} className={cn(notOrder && "bg-muted/40")}>
        <TableCell className="font-medium whitespace-nowrap tabular-nums">
          {l.order_number || "—"}
          {notOrder && (
            <Badge variant="outline" className={cn("ml-2", l.kind === "waiver" && "border-amber-600/40 text-amber-700")} title={title}>
              {b.kinds[l.kind]}
            </Badge>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap tabular-nums">{l.occurred_at ? formatRomeDateTime(l.occurred_at) : "—"}</TableCell>
        <TableCell>{b.methods[l.method]}</TableCell>
        <Money cents={l.gross_cents} quiet={l.gross_cents === 0} />
        <Money cents={l.cash_cents} quiet={l.cash_cents === 0} />
        <Money cents={l.card_cents} quiet={l.card_cents === 0} />
        <Money cents={l.refund_cents} quiet={l.refund_cents === 0} />
        <Money cents={l.base_cents} />
        <TableCell className="text-right whitespace-nowrap tabular-nums">
          <div>{formatEuroCents(l.fee_cents)}</div>
          <div className="text-xs text-muted-foreground">
            {formatRateBps(l.rate_bps)}
            {capped && (
              <span className="ml-1 text-amber-700" title={fmt(b.cappedTitle, { full: formatEuroCents(l.full_fee_cents) })}>
                · {b.capped}
              </span>
            )}
          </div>
        </TableCell>
        <Money cents={l.vat_cents} quiet={l.vat_cents === 0} />
        {l.stripe_fee_cents === null ? (
          <TableCell className="text-right">
            <Badge variant="outline" className="border-amber-600/40 text-amber-700" title={b.pendingTitle}>
              {b.pending}
            </Badge>
          </TableCell>
        ) : (
          <Money cents={l.stripe_fee_cents} quiet={l.stripe_fee_cents === 0} />
        )}
        <TableCell className={cn("text-right whitespace-nowrap tabular-nums", l.net_cents < 0 && "text-destructive")}>{formatEuroCents(l.net_cents)}</TableCell>
        <TableCell className="text-right">
          {l.waivable && l.fee_cents > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setWaiving(l)} disabled={waiveBusy}>
              {b.waive.button}
            </Button>
          )}
        </TableCell>
      </TableRow>
    )
  }
}

/** Confirm + reason for waiving one cash order's commission. */
function WaiveDialog({
  line,
  busy,
  onClose,
  onConfirm,
}: {
  line: BusinessOrderLine | null
  busy: boolean
  onClose: () => void
  onConfirm: (reason: string) => Promise<string | null>
}) {
  const { t, fmt } = useI18n()
  const w = t.finance.business.waive
  const [reason, setReason] = useState("")
  const [error, setError] = useState("")
  const [openedFor, setOpenedFor] = useState<string | null>(null)

  // Fresh form each time it opens for a line.
  if ((line?.entry_id ?? null) !== openedFor) {
    setOpenedFor(line?.entry_id ?? null)
    setReason("")
    setError("")
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const r = reason.trim()
    if (!r || r.length > 500) {
      setError(w.errors.invalid_reason)
      return
    }
    setError("")
    const err = await onConfirm(r)
    if (err) setError(err)
  }

  const order = line?.order_number || "—"
  return (
    <Dialog open={!!line} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="space-y-4">
          <DialogHeader>
            <DialogTitle>{fmt(w.title, { order })}</DialogTitle>
            <DialogDescription>{fmt(w.body, { fee: formatEuroCents(line?.fee_cents ?? 0) })}</DialogDescription>
          </DialogHeader>
          <Field label={w.reason} hint={w.reasonHint} error={error || undefined}>
            {(p) => (
              <textarea
                {...p}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                disabled={busy}
                placeholder={w.reasonPlaceholder}
                className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm"
              />
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {w.back}
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
              {busy ? w.working : w.confirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Money({ cents, strong, quiet }: { cents: number; strong?: boolean; quiet?: boolean }) {
  return (
    <TableCell className={cn("text-right whitespace-nowrap tabular-nums", strong && "font-semibold", quiet && "text-muted-foreground")}>
      {formatEuroCents(cents)}
    </TableCell>
  )
}

function CapSub({
  state,
  ratio,
  month,
  fee,
  labels,
  aria,
}: {
  state: "none" | "ok" | "near" | "reached"
  ratio: number
  month: string
  fee: string | null
  labels: { reached: string; near: string; none: string; ok: string }
  aria: string
}) {
  const pct = Math.round(ratio * 100)
  return (
    <div className="space-y-1">
      {state !== "none" && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={aria}>
          <div
            className={cn("h-full rounded-full", state === "reached" ? "bg-green-600" : state === "near" ? "bg-amber-600" : "bg-muted-foreground/50")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div>
        {fee ?? month}
        {fee && ` · ${month}`}
        {state === "reached" && <span className="ml-1 text-green-700">· {labels.reached}</span>}
        {state === "near" && <span className="ml-1 text-amber-700">· {labels.near}</span>}
      </div>
    </div>
  )
}
