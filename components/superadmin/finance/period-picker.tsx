"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/lib/i18n/client"
import { cn } from "@/lib/utils"
import { presetRange, romeRange, type PresetKey } from "@/lib/finance"
import { Field } from "../field"

const PRESETS: PresetKey[] = ["thisMonth", "lastMonth", "thisWeek"]

export type Range = { from: string; to: string }

/** From / To (Rome calendar dates, both included) with quick presets. Calls onApply with a valid range only. */
export function PeriodPicker({ applied, onApply }: { applied: Range; onApply: (r: Range) => void }) {
  const { t } = useI18n()
  const [from, setFrom] = useState(applied.from)
  const [to, setTo] = useState(applied.to)
  const [error, setError] = useState("")
  const [shown, setShown] = useState(applied)

  // Follow an applied range set from outside (a preset, the address).
  if (shown.from !== applied.from || shown.to !== applied.to) {
    setShown(applied)
    setFrom(applied.from)
    setTo(applied.to)
  }

  const apply = (next: Range) => {
    const r = romeRange(next.from, next.to)
    if (!r.ok) {
      setError(t.finance.errors[r.error])
      return
    }
    setError("")
    setFrom(r.from)
    setTo(r.to)
    onApply({ from: r.from, to: r.to })
  }

  return (
    <form
      className="mb-6 flex flex-wrap items-end gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        apply({ from, to })
      }}
    >
      <div className="w-40">
        <Field label={t.finance.range.from}>
          {(p) => <Input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-invalid={error ? true : undefined} />}
        </Field>
      </div>
      <div className="w-40">
        <Field label={t.finance.range.to}>
          {(p) => <Input {...p} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-invalid={error ? true : undefined} />}
        </Field>
      </div>
      <Button type="submit" variant="outline">
        {t.finance.range.apply}
      </Button>
      <div role="group" aria-label={t.finance.range.label} className="inline-flex rounded-md border p-0.5">
        {PRESETS.map((k) => {
          const r = presetRange(k)
          const active = applied.from === r.from && applied.to === r.to
          return (
            <button
              key={k}
              type="button"
              aria-pressed={active}
              onClick={() => apply(r)}
              className={cn(
                "h-8 rounded-[5px] px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.finance.range.presets[k]}
            </button>
          )
        })}
      </div>
      <p className={cn("basis-full text-xs", error ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
        {error || t.finance.range.hint}
      </p>
    </form>
  )
}

/** A summary tile: label, big figure, optional line under it. */
export function Stat({ label, value, sub, hint, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; hint?: string; tone?: "bad" }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3" title={hint}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold whitespace-nowrap tabular-nums", tone === "bad" && "text-destructive")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  )
}
