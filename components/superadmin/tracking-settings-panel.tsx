"use client"

import type React from "react"
import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"
import { parseGa4Id, parseMetaPixelId } from "@/lib/tracking-ids"
import { Field } from "./field"

const tidy = (v: string) => v.replace(/\s+/g, "")

/** The restaurant's own GA4 and Meta Pixel ids (GET/PUT /api/businesses/tracking). */
export function TrackingSettingsPanel({ businessId }: { businessId: string }) {
  const { t, fmt } = useI18n()
  const [saved, setSaved] = useState<{ ga4: string; pixel: string }>({ ga4: "", pixel: "" })
  const [ga4, setGa4] = useState("")
  const [pixel, setPixel] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [fieldErrors, setFieldErrors] = useState<{ ga4?: string; pixel?: string }>({})
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/businesses/tracking?business_id=${businessId}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(t.tracking.errors[j.error] ?? fmt(t.tracking.loadFailed, { reason: apiError(t, j.error, res.status) }))
        return
      }
      const next = { ga4: j.ga4_measurement_id ?? "", pixel: j.meta_pixel_id ?? "" }
      setSaved(next)
      setGa4(next.ga4)
      setPixel(next.pixel)
      setError("")
    } catch {
      setError(fmt(t.tracking.loadFailed, { reason: t.common.network }))
    } finally {
      setLoading(false)
    }
  }, [businessId, t, fmt])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setNotice("")
    setError("")
    const g = parseGa4Id(ga4)
    const p = parseMetaPixelId(pixel)
    const errs = {
      ga4: g.ok ? undefined : t.tracking.errors.invalid_ga4_measurement_id,
      pixel: p.ok ? undefined : t.tracking.errors.invalid_meta_pixel_id,
    }
    setFieldErrors(errs)
    if (!g.ok || !p.ok) return
    setBusy(true)
    try {
      const res = await fetch("/api/businesses/tracking", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, ga4_measurement_id: g.value, meta_pixel_id: p.value }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (j.error === "invalid_ga4_measurement_id") setFieldErrors({ ga4: t.tracking.errors[j.error] })
        else if (j.error === "invalid_meta_pixel_id") setFieldErrors({ pixel: t.tracking.errors[j.error] })
        else setError(t.tracking.errors[j.error] ?? apiError(t, j.error, res.status))
        return
      }
      const next = { ga4: j.ga4_measurement_id ?? "", pixel: j.meta_pixel_id ?? "" }
      setSaved(next)
      setGa4(next.ga4)
      setPixel(next.pixel)
      setNotice(t.tracking.saved)
    } catch {
      setError(t.common.network)
    } finally {
      setBusy(false)
    }
  }

  const dirty = tidy(ga4).toUpperCase() !== saved.ga4 || tidy(pixel) !== saved.pixel
  const nothingSet = !saved.ga4 && !saved.pixel

  return (
    <form onSubmit={submit} noValidate className="max-w-md space-y-4">
      <Field label={t.tracking.ga4Label} hint={t.tracking.ga4Hint} error={fieldErrors.ga4}>
        {(p) => (
          <Input
            {...p}
            value={ga4}
            onChange={(e) => {
              setGa4(e.target.value.toUpperCase())
              setFieldErrors((f) => ({ ...f, ga4: undefined }))
              setNotice("")
            }}
            placeholder={t.tracking.ga4Placeholder}
            autoComplete="off"
            spellCheck={false}
            maxLength={24}
            disabled={loading || busy}
            className="font-mono uppercase"
          />
        )}
      </Field>
      <Field label={t.tracking.pixelLabel} hint={t.tracking.pixelHint} error={fieldErrors.pixel}>
        {(p) => (
          <Input
            {...p}
            value={pixel}
            onChange={(e) => {
              setPixel(e.target.value)
              setFieldErrors((f) => ({ ...f, pixel: undefined }))
              setNotice("")
            }}
            placeholder={t.tracking.pixelPlaceholder}
            autoComplete="off"
            spellCheck={false}
            inputMode="numeric"
            maxLength={24}
            disabled={loading || busy}
            className="font-mono"
          />
        )}
      </Field>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={loading || busy || !dirty}>
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {busy ? t.tracking.saving : t.tracking.save}
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {loading ? null : notice ? notice : nothingSet ? t.tracking.notSet : null}
        </p>
      </div>
    </form>
  )
}
