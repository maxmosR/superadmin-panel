"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, Lock, Save } from "lucide-react"
import { RATE_FIELDS, type BusinessProviderSetting, type RateField } from "@/lib/providers"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"

type Draft = Record<RateField | "customer_service_number", string> & { is_enabled: boolean; tax_locked: boolean }

const toDraft = (p: BusinessProviderSetting): Draft => ({
  is_enabled: p.is_enabled,
  tax_locked: p.tax_locked,
  fee_rate: p.own_fee_rate?.toString() ?? "",
  iva_rate: p.own_iva_rate?.toString() ?? "",
  stripe_fee_rate: p.own_stripe_fee_rate?.toString() ?? "",
  stripe_fixed_fee: p.own_stripe_fixed_fee?.toString() ?? "",
  tax_rate: p.own_tax_rate?.toString() ?? "",
  customer_service_number: p.own_customer_service_number ?? "",
})

/**
 * Per-business provider settings, saved one provider at a time (like the
 * domain manager). An empty field inherits the provider default; "Lock IVA &
 * tax" stops the business from changing those two rates itself.
 */
export function BusinessProvidersEditor({ businessId }: { businessId: string }) {
  const { t, fmt } = useI18n()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const [rows, setRows] = useState<BusinessProviderSetting[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/businesses/providers?business_id=${encodeURIComponent(businessId)}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiError(tRef.current, j.error, res.status))
      const list = (j.providers ?? []) as BusinessProviderSetting[]
      setRows(list)
      setDrafts(Object.fromEntries(list.map((p) => [p.provider_id, toDraft(p)])))
    } catch (e) {
      setError(e instanceof Error && !(e instanceof TypeError) ? e.message : tRef.current.providers.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    load()
  }, [load])

  const set = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))

  const save = async (p: BusinessProviderSetting) => {
    const d = drafts[p.provider_id]
    if (!d) return
    setBusy(p.provider_id)
    setError("")
    setSaved("")
    try {
      const res = await fetch("/api/businesses/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, provider_id: p.provider_id, ...d }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiError(t, j.error, res.status))
      setSaved(fmt(t.providers.savedOne, { name: p.name }))
      await load()
    } catch (e) {
      setError(fmt(t.providers.saveOneFailed, { name: p.name, reason: e instanceof Error && !(e instanceof TypeError) ? e.message : t.common.network }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{t.providers.title}</h3>
        <p className="text-xs text-muted-foreground">{t.providers.businessIntro}</p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <p role="status" className={saved ? "text-xs text-green-700" : "sr-only"}>{saved}</p>

      {loading && rows.length === 0 ? (
        <div className="flex items-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          {t.providers.loading}
        </div>
      ) : (
        <div className="space-y-3">
          {rows
            .filter((p) => p.is_active)
            .map((p) => {
              const d = drafts[p.provider_id] ?? toDraft(p)
              const isBusy = busy === p.provider_id
              return (
                <div key={p.provider_id} className="rounded-md border p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{p.code}</span>
                      {p.is_mandatory && <Badge variant="secondary">{t.providers.mandatory}</Badge>}
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={p.is_mandatory || d.is_enabled}
                          disabled={p.is_mandatory || isBusy}
                          onChange={(e) => set(p.provider_id, { is_enabled: e.target.checked })}
                        />
                        {t.providers.enabled}
                      </label>
                      <label className="flex items-center gap-1.5 text-sm" title={t.providers.lockTitle}>
                        <input
                          type="checkbox"
                          checked={d.tax_locked}
                          disabled={isBusy}
                          onChange={(e) => set(p.provider_id, { tax_locked: e.target.checked })}
                        />
                        <Lock className="h-3.5 w-3.5" aria-hidden />
                        {t.providers.lock}
                      </label>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    {RATE_FIELDS.map((f) => (
                      <div key={f} className="space-y-1">
                        <Label className="text-xs">{t.providers.rates[f]}</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min={0}
                          value={d[f]}
                          disabled={isBusy}
                          placeholder={fmt(t.providers.defaultValue, { v: String(p[`default_${f}`]) })}
                          onChange={(e) => set(p.provider_id, { [f]: e.target.value } as Partial<Draft>)}
                        />
                      </div>
                    ))}
                    <div className="space-y-1">
                      <Label className="text-xs">{t.providers.serviceNumber}</Label>
                      <Input
                        type="tel"
                        value={d.customer_service_number}
                        disabled={isBusy}
                        placeholder={p.default_customer_service_number ? fmt(t.providers.defaultValue, { v: p.default_customer_service_number }) : "+39 …"}
                        onChange={(e) => set(p.provider_id, { customer_service_number: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" onClick={() => save(p)} disabled={isBusy}>
                      {isBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                      {fmt(t.providers.saveOne, { name: p.name })}
                    </Button>
                  </div>
                </div>
              )
            })}
        </div>
      )}
    </section>
  )
}
