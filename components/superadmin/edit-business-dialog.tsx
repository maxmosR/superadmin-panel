"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Loader2 } from "lucide-react"
import { DomainManager } from "./domain-manager"
import { BusinessProvidersEditor } from "./business-providers-editor"
import { StaffRolesPanel } from "./staff-roles-panel"
import type { BusinessRow } from "./superadmin-dashboard"

interface Props {
  business: BusinessRow | null
  onOpenChange: (open: boolean) => void
  rootDomain: string
  onSaved: () => void
}

export function EditBusinessDialog({ business, onOpenChange, rootDomain, onSaved }: Props) {
  const [form, setForm] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  // Prefill whenever a business is opened for editing.
  useEffect(() => {
    if (!business) return
    setError("")
    setForm({
      business_name: business.business_name ?? "",
      name_abbreviation: business.name_abbreviation ?? "",
      tax_id: business.tax_id ?? "",
      address: business.address ?? "",
      phone: business.phone ?? "",
      email: business.email ?? "",
      logo_url: business.logo_url ?? "",
      timezone: business.config?.timezone ?? "Europe/Rome",
      currency: business.config?.currency ?? "EUR",
      minimum_charge: String(business.config?.minimum_charge ?? "0"),
      max_concurrent_appointments: String(business.config?.max_concurrent_appointments ?? "6"),
      open_days_and_hours: business.config?.open_days_and_hours
        ? JSON.stringify(business.config.open_days_and_hours)
        : "",
      sms_sender_name: business.sms_sender_name ?? "",
      email_from_name: business.email_from_name ?? "",
      order_notification_email: business.order_notification_email ?? "",
      pay_card: business.config?.payment_methods?.card === false ? "off" : "on",
      pay_cash: business.config?.payment_methods?.cash === false ? "off" : "on",
    })
  }, [business])

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!business) return
    setError("")

    let openHours: unknown = null
    if (form.open_days_and_hours.trim()) {
      try {
        openHours = JSON.parse(form.open_days_and_hours)
      } catch {
        setError("Open days & hours must be valid JSON (or leave it empty).")
        return
      }
    }

    if (form.pay_card === "off" && form.pay_cash === "off") {
      setError("Keep at least one payment method on.")
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/businesses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: business.business_id,
          business_name: form.business_name,
          name_abbreviation: form.name_abbreviation,
          tax_id: form.tax_id || null,
          address: form.address || null,
          phone: form.phone || null,
          email: form.email || null,
          logo_url: form.logo_url || null,
          timezone: form.timezone,
          currency: form.currency,
          minimum_charge: Number(form.minimum_charge) || 0,
          max_concurrent_appointments: Number(form.max_concurrent_appointments) || 6,
          open_days_and_hours: openHours,
          sms_sender_name: form.sms_sender_name || null,
          email_from_name: form.email_from_name || null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`)

      // Order email and payment methods: their own command (set_order_settings).
      const res2 = await fetch("/api/businesses/order-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_id: business.business_id,
          order_notification_email: form.order_notification_email.trim() || null,
          payment_methods: { card: form.pay_card === "on", cash: form.pay_cash === "on" },
        }),
      })
      const j2 = await res2.json().catch(() => ({}))
      if (!res2.ok) throw new Error(j2.error || `Order settings failed (${res2.status})`)

      onSaved()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update business")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!business} onOpenChange={(o) => (o ? undefined : onOpenChange(false))}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit business</DialogTitle>
          <DialogDescription>
            {business ? `Slug: ${business.slug} (cannot be changed)` : "Update business details and configuration."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-5">
          {/* Business details */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Business details</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Business name *">
                <Input value={form.business_name ?? ""} onChange={(e) => set("business_name", e.target.value)} />
              </Field>
              <Field label="Abbreviation *">
                <Input value={form.name_abbreviation ?? ""} onChange={(e) => set("name_abbreviation", e.target.value)} />
              </Field>
              <Field label="Tax ID">
                <Input value={form.tax_id ?? ""} onChange={(e) => set("tax_id", e.target.value)} />
              </Field>
              <Field label="Phone">
                <Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label="Business email">
                <Input type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <Field label="Address">
                <Input value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} />
              </Field>
            </div>
          </section>

          <Separator />

          {/* Domains — a business can be reached on any number of hosts. */}
          {business && <DomainManager businessId={business.business_id} rootDomain={rootDomain} />}

          <Separator />

          {/* Providers — saved per provider, like the domains above. */}
          {business && <BusinessProvidersEditor businessId={business.business_id} />}

          <Separator />

          {/* Configuration */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Configuration</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Timezone">
                <Input value={form.timezone ?? ""} onChange={(e) => set("timezone", e.target.value)} />
              </Field>
              <Field label="Currency">
                <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="CHF">CHF</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Minimum charge">
                <Input
                  type="number"
                  step="0.01"
                  value={form.minimum_charge ?? ""}
                  onChange={(e) => set("minimum_charge", e.target.value)}
                />
              </Field>
              <Field label="Max concurrent appointments">
                <Input
                  type="number"
                  value={form.max_concurrent_appointments ?? ""}
                  onChange={(e) => set("max_concurrent_appointments", e.target.value)}
                />
              </Field>
            </div>
            <Field label="Open days & hours (JSON, optional)">
              <textarea
                value={form.open_days_and_hours ?? ""}
                onChange={(e) => set("open_days_and_hours", e.target.value)}
                rows={3}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              />
            </Field>
          </section>

          <Separator />

          {/* Branding */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Branding</h3>
            <div className="flex flex-wrap gap-2 text-xs">
              <ReadinessBadge ok={!!business?.readiness?.has_owner} label="At least one owner" />
              <ReadinessBadge ok={!!business?.readiness?.sms_sender_set} label="SMS sender name set" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Slug">
                <Input value={business?.slug ?? ""} readOnly disabled />
              </Field>
              <Field label="SMS sender name (3–11, registered at OpenAPI.com)">
                <Input
                  value={form.sms_sender_name ?? ""}
                  maxLength={11}
                  onChange={(e) => set("sms_sender_name", e.target.value)}
                />
              </Field>
              <Field label="Email display name">
                <Input
                  value={form.email_from_name ?? ""}
                  maxLength={80}
                  onChange={(e) => set("email_from_name", e.target.value)}
                />
              </Field>
            </div>
          </section>

          <Separator />

          {/* Online orders */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Online orders</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Order email (receives every new order)">
                <Input
                  type="email"
                  value={form.order_notification_email ?? ""}
                  onChange={(e) => set("order_notification_email", e.target.value)}
                  placeholder="ordini@restaurant.it"
                />
              </Field>
              <div className="flex flex-col gap-2 text-sm">
                <span className="text-xs text-muted-foreground">Payment methods (at least one)</span>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.pay_card === "on"}
                    onChange={(e) => set("pay_card", e.target.checked ? "on" : "off")}
                  />
                  Card (needs a ready payout account)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.pay_cash === "on"}
                    onChange={(e) => set("pay_cash", e.target.checked ? "on" : "off")}
                  />
                  Cash on delivery
                </label>
              </div>
            </div>
          </section>

          <Separator />

          {/* Staff and owners */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Staff and owners</h3>
            {business && <StaffRolesPanel businessId={business.business_id} onChanged={onSaved} />}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function ReadinessBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={
        "rounded-full border px-2 py-0.5 " +
        (ok ? "border-green-600/40 text-green-700 dark:text-green-400" : "border-amber-600/40 text-amber-700 dark:text-amber-400")
      }
    >
      {ok ? "✓" : "!"} {label}
    </span>
  )
}
