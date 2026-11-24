"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useI18n } from "@/lib/i18n/client"
import { financeError } from "@/lib/finance-error"
import { cn } from "@/lib/utils"
import { ROME_TZ, formatEuroCents, type PlatformBalance } from "@/lib/finance"
import { Stat } from "./period-picker"

// BirraOra's own Stripe balance: what Approve & pay can transfer right now,
// against what the waiting settlements need.
export function StripeBalanceCard({
  awaitingCents,
  awaitingCount,
  reloadKey = 0,
}: {
  awaitingCents: number | null
  awaitingCount: number
  /** Bump to read the balance again (after a payout). */
  reloadKey?: number
}) {
  const { t, fmt } = useI18n()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const b = t.finance.balance

  const [bal, setBal] = useState<PlatformBalance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/finance/balance", { cache: "no-store" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(financeError(tRef.current, j, res.status))
        return
      }
      setBal(j as PlatformBalance)
    } catch {
      setError(tRef.current.common.network)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  const dayFmt = useMemo(() => new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" }), [])
  const timeFmt = useMemo(() => new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: ROME_TZ }), [])

  const short = bal && awaitingCents !== null ? awaitingCents - bal.available_cents : null

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">{b.title}</CardTitle>
          <CardDescription>{b.description}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {bal?.as_of && !loading && <span className="text-xs text-muted-foreground">{fmt(b.asOf, { time: timeFmt.format(new Date(bal.as_of)) })}</span>}
          <Button type="button" size="sm" variant="ghost" onClick={() => void load()} disabled={loading} aria-label={b.refresh}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
            <span className="hidden sm:inline">{b.refresh}</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && !bal ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1.2fr]">
            <Stat label={b.available} value={bal ? formatEuroCents(bal.available_cents) : "—"} />
            <Stat label={b.pending} value={bal ? formatEuroCents(bal.pending_cents) : "—"} />
            <Stat
              label={b.awaiting}
              value={awaitingCents === null ? "—" : formatEuroCents(awaitingCents)}
              tone={short !== null && short > 0 ? "bad" : undefined}
              sub={
                awaitingCents === null || !bal ? undefined : (
                  <>
                    <div>{fmt(b.awaitingSub, { n: awaitingCount })}</div>
                    {awaitingCount > 0 && (
                      <div className={cn(short !== null && short > 0 ? "text-destructive" : "text-green-700")}>
                        {short !== null && short > 0 ? fmt(b.short, { amount: formatEuroCents(short) }) : b.enough}
                      </div>
                    )}
                  </>
                )
              }
            />
            <div className="rounded-lg border bg-card px-4 py-3">
              <div className="text-xs font-medium text-muted-foreground">{b.upcomingTitle}</div>
              {!bal ? (
                <div className="mt-1 text-lg font-semibold">—</div>
              ) : bal.upcoming.length === 0 ? (
                <div className="mt-1 text-sm text-muted-foreground">{b.upcomingNone}</div>
              ) : (
                <ul className="mt-1 space-y-0.5 text-sm">
                  {bal.upcoming.slice(0, 5).map((u) => (
                    <li key={u.date} className="flex justify-between gap-4 tabular-nums">
                      <span>{dayFmt.format(new Date(`${u.date}T12:00:00Z`))}</span>
                      <span className="font-medium">{formatEuroCents(u.amount_cents)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {bal?.upcoming_partial && <div className="mt-1 text-xs text-muted-foreground">{b.upcomingPartial}</div>}
            </div>
          </div>
        )}
        {error && bal && <p className="mt-2 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
