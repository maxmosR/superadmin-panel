"use client"

import { cloneElement, useCallback, useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, Pencil, Plus } from "lucide-react"
import { CALC_MODES, RATE_FIELDS, type CalcMode, type Provider } from "@/lib/providers"
import { useI18n } from "@/lib/i18n/client"
import { formatDecimal, formatMoney } from "@/lib/i18n/number"
import { ConsoleShell, PageHead } from "./console-shell"
import { apiError } from "@/lib/i18n/api-error"

type Form = Record<string, string> & { calc_mode: CalcMode }
type Flags = { is_active: boolean; is_mandatory: boolean }

const emptyForm = (): Form => ({
  code: "",
  name: "",
  calc_mode: "marketplace",
  icon_url: "",
  sort_order: "100",
  default_fee_rate: "0",
  default_iva_rate: "22",
  default_stripe_fee_rate: "0",
  default_stripe_fixed_fee: "0",
  default_tax_rate: "2",
  default_customer_service_number: "",
})

const toForm = (p: Provider): Form => ({
  code: p.code,
  name: p.name,
  calc_mode: p.calc_mode,
  icon_url: p.icon_url ?? "",
  sort_order: String(p.sort_order),
  default_fee_rate: String(p.default_fee_rate),
  default_iva_rate: String(p.default_iva_rate),
  default_stripe_fee_rate: String(p.default_stripe_fee_rate),
  default_stripe_fixed_fee: String(p.default_stripe_fixed_fee),
  default_tax_rate: String(p.default_tax_rate),
  default_customer_service_number: p.default_customer_service_number ?? "",
})

/** The providers page: the platform's list, in the console frame. */
export function ProvidersPage({ adminEmail }: { adminEmail: string | null }) {
  return (
    <ConsoleShell adminEmail={adminEmail}>
      <ProvidersManager />
    </ConsoleShell>
  )
}

/** Platform master list of providers: create, edit, disable, mark mandatory. */
export function ProvidersManager() {
  const { t, fmt } = useI18n()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Dialog: editing = null → create.
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Provider | null>(null)
  const [form, setForm] = useState<Form>(emptyForm)
  const [flags, setFlags] = useState<Flags>({ is_active: true, is_mandatory: false })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/providers")
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiError(tRef.current, j.error, res.status))
      setProviders(j.providers ?? [])
    } catch (e) {
      setError(e instanceof Error && !(e instanceof TypeError) ? e.message : tRef.current.providers.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm())
    setFlags({ is_active: true, is_mandatory: false })
    setFormError("")
    setOpen(true)
  }

  const openEdit = (p: Provider) => {
    setEditing(p)
    setForm(toForm(p))
    setFlags({ is_active: p.is_active, is_mandatory: p.is_mandatory })
    setFormError("")
    setOpen(true)
  }

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const handleSave = async () => {
    setSaving(true)
    setFormError("")
    try {
      const { code, ...rest } = form
      const body = editing
        ? { id: editing.id, ...rest, ...flags }
        : { code: code.trim().toLowerCase(), ...rest, ...flags }
      const res = await fetch("/api/providers", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiError(t, j.error, res.status))
      setOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error && !(e instanceof TypeError) ? e.message : t.providers.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const fmtRates = (p: Provider) => {
    const parts: string[] = []
    if (Number(p.default_fee_rate)) parts.push(fmt(t.providers.feeShort, { n: formatDecimal(Number(p.default_fee_rate)) }))
    if (Number(p.default_iva_rate) && Number(p.default_fee_rate))
      parts.push(fmt(t.providers.ivaShort, { n: formatDecimal(Number(p.default_iva_rate)) }))
    if (Number(p.default_stripe_fee_rate) || Number(p.default_stripe_fixed_fee))
      parts.push(`${formatDecimal(Number(p.default_stripe_fee_rate))}% + ${formatMoney(Number(p.default_stripe_fixed_fee))}`)
    parts.push(fmt(t.providers.taxShort, { n: formatDecimal(Number(p.default_tax_rate)) }))
    return parts.join(" · ")
  }

  return (
    <>
      <PageHead
        title={t.providers.title}
        description={t.providers.pageDescription}
        action={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden />
            {t.providers.add}
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? null : t.providers.count(providers.length)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && providers.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
              {t.providers.loading}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.providers.colProvider}</TableHead>
                    <TableHead>{t.providers.colMode}</TableHead>
                    <TableHead>{t.providers.colRates}</TableHead>
                    <TableHead>{t.providers.colService}</TableHead>
                    <TableHead>{t.providers.colStatus}</TableHead>
                    <TableHead className="text-right">{t.providers.colActions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providers.map((p) => (
                    <TableRow key={p.id} className={p.is_active ? undefined : "opacity-60"}>
                      <TableCell>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.code}</div>
                      </TableCell>
                      <TableCell className="text-sm">{t.providers.modes[p.calc_mode] ?? p.calc_mode}</TableCell>
                      <TableCell className="text-sm">{fmtRates(p)}</TableCell>
                      <TableCell className="text-sm">{p.default_customer_service_number ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {p.is_mandatory && <Badge variant="secondary">{t.providers.mandatory}</Badge>}
                          <Badge variant={p.is_active ? "secondary" : "outline"}>
                            {p.is_active ? t.providers.active : t.providers.disabled}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                          <Pencil className="mr-1 h-4 w-4" aria-hidden />
                          {t.common.edit}
                          <span className="sr-only"> {p.name}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? fmt(t.providers.editTitle, { name: editing.name }) : t.providers.add}</DialogTitle>
            <DialogDescription>{t.providers.dialogDescription}</DialogDescription>
          </DialogHeader>

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.providers.name}>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Just Eat" />
              </Field>
              <Field label={editing ? t.providers.codeFixed : t.providers.code}>
                <Input
                  value={form.code}
                  disabled={!!editing}
                  onChange={(e) => set("code", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  placeholder="justeat"
                />
              </Field>
              {/* Full row: the long mode descriptions don't fit half the dialog. */}
              <Field label={t.providers.invoiceMode} id="provider-calc-mode" className="sm:col-span-2">
                <Select value={form.calc_mode} onValueChange={(v) => setForm((f) => ({ ...f, calc_mode: v as CalcMode }))}>
                  <SelectTrigger id="provider-calc-mode" className="w-full min-w-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CALC_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {t.providers.modeLong[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t.providers.sortOrder}>
                <Input type="number" value={form.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
              </Field>
              <Field label={t.providers.iconUrl}>
                <Input value={form.icon_url} onChange={(e) => set("icon_url", e.target.value)} placeholder="https://… / /icons/name.png" />
              </Field>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold">{t.providers.defaultRates}</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                {RATE_FIELDS.map((f) => (
                  <Field key={f} label={t.providers.rates[f]}>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={form[`default_${f}`]}
                      onChange={(e) => set(`default_${f}`, e.target.value)}
                    />
                  </Field>
                ))}
                <Field label={t.providers.serviceNumber}>
                  <Input
                    type="tel"
                    value={form.default_customer_service_number}
                    onChange={(e) => set("default_customer_service_number", e.target.value)}
                    placeholder="+39 …"
                  />
                </Field>
              </div>
            </div>

            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={flags.is_mandatory}
                  onChange={(e) =>
                    setFlags((f) => ({ is_mandatory: e.target.checked, is_active: e.target.checked || f.is_active }))
                  }
                />
                {t.providers.mandatoryCheck}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={flags.is_active}
                  disabled={flags.is_mandatory}
                  onChange={(e) => setFlags((f) => ({ ...f, is_active: e.target.checked }))}
                />
                {t.providers.activeCheck}
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              {t.common.cancel}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editing ? t.edit.saveChanges : t.providers.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Label + control. The label is tied to the control: an input child gets a
 * generated id; pass `id` when the control is nested (a Select's trigger).
 */
function Field({ label, id, className, children }: { label: string; id?: string; className?: string; children: React.ReactElement<{ id?: string }> }) {
  const auto = useId()
  const controlId = id ?? auto
  return (
    <div className={"min-w-0 space-y-1.5 " + (className ?? "")}>
      <Label htmlFor={controlId} className="text-sm">
        {label}
      </Label>
      {id ? children : cloneElement(children, { id: controlId })}
    </div>
  )
}
