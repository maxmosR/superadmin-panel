"use client"

import type React from "react"
import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"
import {
  bpsToPercentString,
  centsToEuroString,
  formatEuroCents,
  formatRateBps,
  normaliseDecimalInput,
  parseEuroToCents,
  parseRatePercent,
} from "@/lib/finance"
import { Field } from "./field"

interface Saved {
  rate_bps: number
  monthly_cap_cents: number | null
  updated_at: string | null
}

/** The restaurant's commission rate and monthly cap (GET/PUT /api/businesses/commission). */
export function CommissionSettingsPanel({ businessId }: { businessId: string }) {
  const { t, fmt, locale } = useI18n()
  const [saved, setSaved] = useState<Saved | null>(null)
  const [rate, setRate] = useState("")
  const [cap, setCap] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [rateError, setRateError] = useState("")
  const [capError, setCapError] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const show = useCallback((s: Saved) => {
    setSaved(s)
    setRate(bpsToPercentString(s.rate_bps))
    setCap(s.monthly_cap_cents === null ? "" : centsToEuroString(s.monthly_cap_cents))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/businesses/commission?business_id=${businessId}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(t.finance.commission.errors[j.error] ?? fmt(t.finance.commission.loadFailed, { reason: apiError(t, j.error, res.status) }))
        return
      }
      show(j)
      setError("")
    } catch {
      setError(fmt(t.finance.commission.loadFailed, { reason: t.common.network }))
    } finally {
      setLoading(false)
    }
  }, [businessId, t, fmt, show])

  useEffect(() => {
    void load()
  }, [load])

  const rateBps = parseRatePercent(rate)
  const capTrim = cap.trim()
  const capCents = capTrim === "" ? null : parseEuroToCents(capTrim)
  const dirty = !!saved && (rateBps !== saved.rate_bps || capCents !== saved.monthly_cap_cents || (capTrim !== "" && capCents === null))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setNotice("")
    setError("")
    const rErr = rateBps === null ? t.finance.commission.errors.invalid_rate : ""
    const cErr = capTrim !== "" && capCents === null ? t.finance.commission.errors.invalid_cap : ""
    setRateError(rErr)
    setCapError(cErr)
    if (rErr || cErr) return
    setBusy(true)
    try {
      const res = await fetch("/api/businesses/commission", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: businessId,
          rate_percent: Number(normaliseDecimalInput(rate)),
          monthly_cap_eur: capTrim === "" ? null : Number(normaliseDecimalInput(capTrim)),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = t.finance.commission.errors[j.error] ?? apiError(t, j.error, res.status)
        if (j.error === "invalid_rate") setRateError(msg)
        else if (j.error === "invalid_cap") setCapError(msg)
        else setError(msg)
        return
      }
      show(j)
      setNotice(t.finance.commission.saved)
    } catch {
      setError(t.common.network)
    } finally {
      setBusy(false)
    }
  }

  const date = saved?.updated_at
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(saved.updated_at))
    : null
  const summary = saved
    ? saved.monthly_cap_cents === null
      ? fmt(t.finance.commission.summaryNoCap, { rate: formatRateBps(saved.rate_bps) })
      : fmt(t.finance.commission.summary, { rate: formatRateBps(saved.rate_bps), cap: formatEuroCents(saved.monthly_cap_cents) })
    : null

  return (
    <form onSubmit={submit} noValidate className="max-w-md space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.finance.commission.rateLabel} hint={t.finance.commission.rateHint} error={rateError || undefined}>
          {(p) => (
            <Input
              {...p}
              value={rate}
              onChange={(e) => {
                setRate(e.target.value)
                setRateError("")
                setNotice("")
              }}
              inputMode="decimal"
              autoComplete="off"
              placeholder="15"
              disabled={loading || busy}
              className="tabular-nums"
            />
          )}
        </Field>
        <Field label={t.finance.commission.capLabel} hint={t.finance.commission.capHint} error={capError || undefined}>
          {(p) => (
            <Input
              {...p}
              value={cap}
              onChange={(e) => {
                setCap(e.target.value)
                setCapError("")
                setNotice("")
              }}
              inputMode="decimal"
              autoComplete="off"
              placeholder="250"
              disabled={loading || busy}
              className="tabular-nums"
            />
          )}
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">{t.finance.commission.vatNote}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={loading || busy || !dirty}>
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {busy ? t.finance.commission.saving : t.finance.commission.save}
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {loading
            ? null
            : notice
              ? notice
              : saved?.updated_at
                ? `${summary}. ${date ? fmt(t.finance.commission.updated, { date }) : ""}`
                : saved
                  ? t.finance.commission.notSet
                  : null}
        </p>
      </div>
    </form>
  )
}
