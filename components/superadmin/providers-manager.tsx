"use client"

import { useCallback, useEffect, useState } from "react"
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
import { CALC_MODES, CALC_MODE_LABELS, RATE_FIELDS, RATE_LABELS, type CalcMode, type Provider } from "@/lib/providers"

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

/** Platform master list of providers: create, edit, disable, mark mandatory. */
export function ProvidersManager() {
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
      if (!res.ok) throw new Error(j.error || `Failed to load (${res.status})`)
      setProviders(j.providers ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load providers")
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
      if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`)
      setOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save provider")
    } finally {
      setSaving(false)
    }
  }

  const fmtRates = (p: Provider) => {
    const parts: string[] = []
    if (Number(p.default_fee_rate)) parts.push(`${p.default_fee_rate}% fee`)
    if (Number(p.default_iva_rate) && Number(p.default_fee_rate)) parts.push(`${p.default_iva_rate}% IVA`)
    if (Number(p.default_stripe_fee_rate) || Number(p.default_stripe_fixed_fee))
      parts.push(`${p.default_stripe_fee_rate}% + €${Number(p.default_stripe_fixed_fee).toFixed(2)}`)
    parts.push(`${p.default_tax_rate}% tax`)
    return parts.join(" · ")
  }

  return (
    <>
      <div className="mb-4 mt-10 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Providers</h2>
          <p className="text-sm text-muted-foreground">
            Sales channels and payment providers businesses can use, with their default rates.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Add provider
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? "Loading…" : `${providers.length} provider${providers.length === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && providers.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading providers…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Provider</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Default rates</TableHead>
                    <TableHead>Customer service</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {providers.map((p) => (
                    <TableRow key={p.id} className={p.is_active ? undefined : "opacity-60"}>
                      <TableCell>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.code}</div>
                      </TableCell>
                      <TableCell className="text-sm capitalize">{p.calc_mode}</TableCell>
                      <TableCell className="text-sm">{fmtRates(p)}</TableCell>
                      <TableCell className="text-sm">{p.default_customer_service_number ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {p.is_mandatory && <Badge>mandatory</Badge>}
                          <Badge variant={p.is_active ? "secondary" : "outline"}>
                            {p.is_active ? "active" : "disabled"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                          <Pencil className="mr-1 h-4 w-4" />
                          Edit
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
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add provider"}</DialogTitle>
            <DialogDescription>
              Defaults apply to every business that hasn&apos;t set its own value.
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name *">
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Just Eat" />
              </Field>
              <Field label={editing ? "Code (fixed)" : "Code *"}>
                <Input
                  value={form.code}
                  disabled={!!editing}
                  onChange={(e) => set("code", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  placeholder="justeat"
                />
              </Field>
              <Field label="Invoice mode">
                <Select value={form.calc_mode} onValueChange={(v) => setForm((f) => ({ ...f, calc_mode: v as CalcMode }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CALC_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {CALC_MODE_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Sort order">
                <Input type="number" value={form.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Icon URL (optional)">
                  <Input
                    value={form.icon_url}
                    onChange={(e) => set("icon_url", e.target.value)}
                    placeholder="https://… or /icons/name.png"
                  />
                </Field>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Default rates</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                {RATE_FIELDS.map((f) => (
                  <Field key={f} label={RATE_LABELS[f]}>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={form[`default_${f}`]}
                      onChange={(e) => set(`default_${f}`, e.target.value)}
                    />
                  </Field>
                ))}
                <Field label="Customer service number">
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
                Mandatory — always enabled for every business; they cannot switch it off
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={flags.is_active}
                  disabled={flags.is_mandatory}
                  onChange={(e) => setFlags((f) => ({ ...f, is_active: e.target.checked }))}
                />
                Active — offered to businesses (untick to disable; existing invoices keep it)
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editing ? "Save changes" : "Create provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  )
}
