"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CheckCircle2, ChevronDown, Loader2, Lock } from "lucide-react"
import { RATE_FIELDS, type BusinessProviderSetting, type RateField } from "@/lib/providers"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"
import { cn } from "@/lib/utils"

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

const same = (a: Draft, b: Draft) => (Object.keys(a) as (keyof Draft)[]).every((k) => a[k] === b[k])
const ownCount = (d: Draft) => [...RATE_FIELDS, "customer_service_number" as const].filter((f) => d[f].trim() !== "").length

/**
 * One restaurant's providers. Each is a single line (on or off, defaults or
 * how many own rates) that opens for editing; most restaurants keep the
 * defaults, so the fee fields stay out of the way. One Save covers every
 * provider changed. An empty field inherits the provider default; "Lock IVA &
 * tax" stops the restaurant changing those two rates itself.
 */
export function BusinessProvidersEditor({ businessId, onDirty }: { businessId: string; onDirty?: (dirty: boolean) => void }) {
  const { t, fmt } = useI18n()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const [rows, setRows] = useState<BusinessProviderSetting[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/businesses/providers?business_id=${encodeURIComponent(businessId)}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiError(tRef.current, j.error, res.status))
      const list = ((j.providers ?? []) as BusinessProviderSetting[]).filter((p) => p.is_active)
      setRows(list)
      setDrafts(Object.fromEntries(list.map((p) => [p.provider_id, toDraft(p)])))
    } catch (e) {
      setError(e instanceof Error && !(e instanceof TypeError) ? e.message : tRef.current.providers.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    void load()
  }, [load])

  const changed = rows.filter((p) => drafts[p.provider_id] && !same(drafts[p.provider_id], toDraft(p)))
  const dirty = changed.length > 0
  useEffect(() => {
    onDirty?.(dirty)
  }, [dirty, onDirty])

  const set = (id: string, patch: Partial<Draft>) => {
    setSaved(false)
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  const saveAll = async () => {
    setSaving(true)
    setError("")
    setSaved(false)
    const failures: string[] = []
    const failedIds: string[] = []
    for (const p of changed) {
      try {
        const res = await fetch("/api/businesses/providers", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ business_id: businessId, provider_id: p.provider_id, ...drafts[p.provider_id] }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) {
          failures.push(fmt(t.providers.saveOneFailed, { name: p.name, reason: apiError(t, j.error, res.status) }))
          failedIds.push(p.provider_id)
        }
      } catch {
        failures.push(fmt(t.providers.saveOneFailed, { name: p.name, reason: t.common.network }))
        failedIds.push(p.provider_id)
      }
    }
    // Reload either way: what saved is now the baseline, what failed stays edited.
    const kept = Object.fromEntries(failedIds.map((id) => [id, drafts[id]]))
    await load()
    if (Object.keys(kept).length) setDrafts((d) => ({ ...d, ...kept }))
    if (failures.length) setError(failures.join(" "))
    else setSaved(true)
    setSaving(false)
  }

  if (loading && rows.length === 0) {
    return (
      <div className="flex items-center text-sm text-muted-foreground" role="status">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
        {t.providers.loading}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ul className="divide-y rounded-md border">
        {rows.map((p) => {
          const d = drafts[p.provider_id] ?? toDraft(p)
          const isOpen = !!open[p.provider_id]
          const own = ownCount(d)
          const enabled = p.is_mandatory || d.is_enabled
          const panelId = `provider-${p.provider_id}`
          return (
            <li key={p.provider_id} className="px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <label className="flex flex-wrap items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={enabled}
                      disabled={p.is_mandatory || saving}
                      onChange={(e) => set(p.provider_id, { is_enabled: e.target.checked })}
                    />
                    <span className="font-medium">{p.name}</span>
                    {p.is_mandatory && <Badge variant="secondary">{t.providers.mandatory}</Badge>}
                  </label>
                  <p className="mt-0.5 pl-6 text-xs text-muted-foreground">
                    {!enabled ? t.providers.off : own ? t.providers.customCount(own) : t.providers.usesDefaults}
                    {d.tax_locked && (
                      <>
                        {" · "}
                        <Lock className="inline h-3 w-3 align-[-1px]" aria-hidden /> {t.providers.locked}
                      </>
                    )}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  aria-label={isOpen ? undefined : fmt(t.providers.customizeLabel, { name: p.name })}
                  onClick={() => setOpen((o) => ({ ...o, [p.provider_id]: !isOpen }))}
                >
                  {isOpen ? t.providers.hideCustom : t.providers.customize}
                  <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} aria-hidden />
                </Button>
              </div>

              {isOpen && (
                <div id={panelId} className="mt-3 space-y-3 border-t pt-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {RATE_FIELDS.map((f) => (
                      <div key={f} className="space-y-1">
                        <Label htmlFor={`${panelId}-${f}`} className="text-xs">
                          {t.providers.rates[f]}
                        </Label>
                        <Input
                          id={`${panelId}-${f}`}
                          type="number"
                          step="0.01"
                          min={0}
                          value={d[f]}
                          disabled={saving}
                          placeholder={fmt(t.providers.defaultValue, { v: String(p[`default_${f}`]) })}
                          onChange={(e) => set(p.provider_id, { [f]: e.target.value } as Partial<Draft>)}
                        />
                      </div>
                    ))}
                    <div className="space-y-1">
                      <Label htmlFor={`${panelId}-csn`} className="text-xs">
                        {t.providers.serviceNumber}
                      </Label>
                      <Input
                        id={`${panelId}-csn`}
                        type="tel"
                        value={d.customer_service_number}
                        disabled={saving}
                        placeholder={
                          p.default_customer_service_number ? fmt(t.providers.defaultValue, { v: p.default_customer_service_number }) : "+39 …"
                        }
                        onChange={(e) => set(p.provider_id, { customer_service_number: e.target.value })}
                      />
                    </div>
                  </div>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={d.tax_locked}
                      disabled={saving}
                      onChange={(e) => set(p.provider_id, { tax_locked: e.target.checked })}
                      className="mt-0.5 h-4 w-4 accent-primary"
                    />
                    <span>
                      {t.providers.lock}
                      <span className="block text-xs text-muted-foreground">{t.providers.lockTitle}</span>
                    </span>
                  </label>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {/* Same rule as the other sections: the save bar shows when there's something to save. */}
      {(dirty || saved || saving) && (
      <div className="flex flex-wrap items-center justify-end gap-3">
        <p role="status" className="mr-auto text-xs">
          {dirty ? (
            <span className="text-amber-700">{t.edit.unsaved}</span>
          ) : saved ? (
            <span className="inline-flex items-center gap-1 text-green-700">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              {t.providers.savedAll}
            </span>
          ) : null}
        </p>
        {dirty && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => setDrafts(Object.fromEntries(rows.map((p) => [p.provider_id, toDraft(p)])))}
          >
            {t.common.cancel}
          </Button>
        )}
        <Button type="button" size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || saving} onClick={() => void saveAll()}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {saving ? t.common.saving : t.providers.saveAll}
        </Button>
      </div>
      )}
    </div>
  )
}
