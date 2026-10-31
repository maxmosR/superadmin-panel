"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import { getReadiness, type SetupSection } from "@/lib/readiness"
import { DomainManager } from "./domain-manager"
import { BusinessProvidersEditor } from "./business-providers-editor"
import { StaffRolesPanel } from "./staff-roles-panel"
import { PayoutAccountCell } from "./payout-account-cell"
import { SetupChecklist } from "./setup-status"
import { Field } from "./field"
import type { BusinessRow } from "./superadmin-dashboard"

/** A section to scroll to when the dialog opens. */
export type EditFocus = SetupSection | "payout"

interface Props {
  business: BusinessRow | null
  focus?: EditFocus
  onOpenChange: (open: boolean) => void
  rootDomain: string
  onSaved: () => void
}

const sectionId = (s: EditFocus) => `edit-section-${s}`

export function EditBusinessDialog({ business, focus, onOpenChange, rootDomain, onSaved }: Props) {
  const [form, setForm] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const openedFor = useRef<string | null>(null)

  // Prefill when a restaurant is opened. A reload of the list while the dialog
  // is open (after a staff or payout change) must not wipe what was typed.
  useEffect(() => {
    if (!business) {
      openedFor.current = null
      return
    }
    if (openedFor.current === business.business_id) return
    openedFor.current = business.business_id
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
      sms_sender_name: business.sms_sender_name ?? "",
      email_from_name: business.email_from_name ?? "",
      order_notification_email: business.order_notification_email ?? "",
      pay_card: business.config?.payment_methods?.card === false ? "off" : "on",
      pay_cash: business.config?.payment_methods?.cash === false ? "off" : "on",
    })
  }, [business])

  const jumpTo = useCallback((section: EditFocus) => {
    const el = document.getElementById(sectionId(section))
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "start" })
    el.focus({ preventScroll: true })
  }, [])

  // Opened from a setup step: land on that section once the dialog has rendered.
  useEffect(() => {
    if (!business || !focus) return
    const t = setTimeout(() => jumpTo(focus), 150)
    return () => clearTimeout(t)
  }, [business, focus, jumpTo])

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!business) return
    setError("")

    if (form.pay_card === "off" && form.pay_cash === "off") {
      setError("Keep at least one payment method on.")
      return
    }

    setSubmitting(true)
    try {
      // Opening hours and appointment limits are the owner's, set in the
      // restaurant's admin panel; they're left out so this never overwrites them.
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
      setError(e instanceof Error ? e.message : "Failed to update the restaurant")
    } finally {
      setSubmitting(false)
    }
  }

  const readiness = business ? getReadiness(business) : null
  const hasHours = readiness?.steps.find((s) => s.key === "hours")?.done

  return (
    <Dialog open={!!business} onOpenChange={(o) => (o ? undefined : onOpenChange(false))}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{business ? business.business_name : "Edit restaurant"}</DialogTitle>
          <DialogDescription>
            {business ? (
              <>
                Slug <span className="font-mono">{business.slug}</span> (can&apos;t be changed)
              </>
            ) : (
              "Update the restaurant's details and settings."
            )}
          </DialogDescription>
        </DialogHeader>

        {business && readiness && (
          <SetupChecklist readiness={readiness} zonesHref={`/businesses/${business.business_id}/zones`} onJump={jumpTo} />
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-5">
          <Section id="details" title="Restaurant details">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Restaurant name">
                {(p) => <Input {...p} value={form.business_name ?? ""} onChange={(e) => set("business_name", e.target.value)} />}
              </Field>
              <Field label="Abbreviation">
                {(p) => <Input {...p} value={form.name_abbreviation ?? ""} onChange={(e) => set("name_abbreviation", e.target.value)} />}
              </Field>
              <Field label="Tax ID">{(p) => <Input {...p} value={form.tax_id ?? ""} onChange={(e) => set("tax_id", e.target.value)} />}</Field>
              <Field label="Phone">
                {(p) => <Input {...p} type="tel" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />}
              </Field>
              <Field label="Restaurant email">
                {(p) => <Input {...p} type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />}
              </Field>
              <Field label="Address">{(p) => <Input {...p} value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} />}</Field>
            </div>
          </Section>

          <Separator />

          {/* Domains: added, switched and removed one by one; each saves at once. */}
          <div id={sectionId("domains")} tabIndex={-1} className="scroll-mt-4 outline-none">
            {business && <DomainManager businessId={business.business_id} rootDomain={rootDomain} />}
          </div>

          <Separator />

          <Section id="branding" title="Branding" description="Names customers see on sign-in codes and emails.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="SMS sender name" hint="3–11 letters, digits or spaces. Register it at OpenAPI.com first.">
                {(p) => (
                  <Input {...p} value={form.sms_sender_name ?? ""} maxLength={11} onChange={(e) => set("sms_sender_name", e.target.value)} />
                )}
              </Field>
              <Field label="Email display name">
                {(p) => (
                  <Input {...p} value={form.email_from_name ?? ""} maxLength={80} onChange={(e) => set("email_from_name", e.target.value)} />
                )}
              </Field>
            </div>
          </Section>

          <Separator />

          <Section id="orders" title="Online orders">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Order email" hint="Receives every new order.">
                {(p) => (
                  <Input
                    {...p}
                    type="email"
                    value={form.order_notification_email ?? ""}
                    onChange={(e) => set("order_notification_email", e.target.value)}
                  />
                )}
              </Field>
              <fieldset className="grid gap-2 text-sm">
                <legend className="mb-1.5 text-sm font-medium">Payment methods</legend>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={form.pay_card === "on"}
                    onChange={(e) => set("pay_card", e.target.checked ? "on" : "off")}
                  />
                  Card <span className="text-muted-foreground">(needs a ready payout account)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={form.pay_cash === "on"}
                    onChange={(e) => set("pay_cash", e.target.checked ? "on" : "off")}
                  />
                  Cash on delivery
                </label>
                <p className="text-xs text-muted-foreground">Keep at least one on.</p>
              </fieldset>
            </div>
            <div id={sectionId("payout")} tabIndex={-1} className="mt-4 scroll-mt-4 rounded-md border p-3 outline-none">
              <div className="mb-2 text-sm font-medium">Payout account</div>
              {business && (
                <PayoutAccountCell businessId={business.business_id} account={business.payout_account ?? null} onCreated={onSaved} />
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                Stripe updates its status once the owner finishes onboarding. Reopen this dialog to see the latest.
              </p>
            </div>
          </Section>

          <Separator />

          <Section id="staff" title="Staff and owners">
            {business && <StaffRolesPanel businessId={business.business_id} onChanged={onSaved} />}
          </Section>

          <Separator />

          <div className="scroll-mt-4">{business && <BusinessProvidersEditor businessId={business.business_id} />}</div>

          <Separator />

          <Section id="configuration" title="Configuration">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Timezone">{(p) => <Input {...p} value={form.timezone ?? ""} onChange={(e) => set("timezone", e.target.value)} />}</Field>
              <Field label="Currency">
                {(p) => (
                  <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                    <SelectTrigger id={p.id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="CHF">CHF</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field label="Minimum order">
                {(p) => (
                  <Input {...p} type="number" step="0.01" min="0" value={form.minimum_charge ?? ""} onChange={(e) => set("minimum_charge", e.target.value)} />
                )}
              </Field>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Opening hours: <span className="text-foreground">{hasHours ? "set" : "not set yet"}</span>. The owner sets them in the
              restaurant&apos;s admin panel.
            </p>
          </Section>
        </div>

        <DialogFooter className="sticky -bottom-6 -mb-6 border-t bg-background py-4">
          <p className="mr-auto hidden self-center text-xs text-muted-foreground sm:block">
            Domains, staff, providers and payout save on their own.
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: EditFocus | "details" | "configuration"
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section id={`edit-section-${id}`} tabIndex={-1} aria-labelledby={`edit-section-${id}-title`} className="scroll-mt-4 space-y-3 outline-none">
      <div>
        <h3 id={`edit-section-${id}-title`} className="text-sm font-semibold">
          {title}
        </h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}
