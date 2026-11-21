"use client"

import type React from "react"
import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"
import { Field } from "./field"

// Same shape check as the server (lib/fiscal-id.ts also checks the check digit/letter).
const SHAPE_OK = (v: string) => /^([0-9]{11}|[A-Z0-9]{16})$/.test(v)
const normalise = (v: string) => v.replace(/\s+/g, "").toUpperCase()

/** The restaurant's own P.IVA / codice fiscale for its receipts (GET/PUT /api/businesses/fiscal-settings). */
export function FiscalSettingsPanel({ businessId }: { businessId: string }) {
  const { t, fmt, locale } = useI18n()
  const [saved, setSaved] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [value, setValue] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/businesses/fiscal-settings?business_id=${businessId}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(t.fiscal.errors[j.error] ?? fmt(t.fiscal.loadFailed, { reason: apiError(t, j.error, res.status) }))
        return
      }
      setSaved(j.fiscal_id ?? null)
      setUpdatedAt(j.updated_at ?? null)
      setValue(j.fiscal_id ?? "")
      setError("")
    } catch {
      setError(fmt(t.fiscal.loadFailed, { reason: t.common.network }))
    } finally {
      setLoading(false)
    }
  }, [businessId, t, fmt])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = normalise(value)
    setNotice("")
    if (!SHAPE_OK(v)) {
      setError(t.fiscal.errors.invalid_fiscal_id)
      return
    }
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/businesses/fiscal-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, fiscal_id: v }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(t.fiscal.errors[j.error] ?? apiError(t, j.error, res.status))
        return
      }
      setSaved(j.fiscal_id)
      setValue(j.fiscal_id)
      setUpdatedAt(new Date().toISOString())
      setNotice(t.fiscal.saved)
    } catch {
      setError(t.common.network)
    } finally {
      setBusy(false)
    }
  }

  const dirty = normalise(value) !== (saved ?? "")
  const date = updatedAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(updatedAt)) : null

  return (
    <form onSubmit={submit} noValidate className="max-w-md space-y-3">
      <Field label={t.fiscal.label} hint={t.fiscal.hint} error={error || undefined}>
        {(p) => (
          <Input
            {...p}
            value={value}
            onChange={(e) => {
              setValue(e.target.value.toUpperCase())
              setNotice("")
            }}
            placeholder={t.fiscal.placeholder}
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            disabled={loading || busy}
            className="font-mono uppercase"
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={loading || busy || !dirty}>
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {busy ? t.fiscal.saving : t.fiscal.save}
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {loading ? null : notice ? notice : saved ? (date ? fmt(t.fiscal.updated, { date }) : null) : t.fiscal.notSet}
        </p>
      </div>
    </form>
  )
}
