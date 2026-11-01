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
import { useConfirm } from "./confirm-dialog"
import type { BusinessRow } from "./superadmin-dashboard"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"

/** A section to scroll to when the dialog opens. */
export type EditFocus = SetupSection | "payout"

interface Props {
  business: BusinessRow | null
  focus?: EditFocus
  /** The button that opened the dialog; focus goes back to it on close. */
  returnFocus?: HTMLElement
  onOpenChange: (open: boolean) => void
  rootDomain: string
  /** Something saved (a field, staff, a domain, the payout account): reload the list. */
  onSaved: () => void
  /** "Save changes" finished; the dialog has closed. */
  onDone?: (businessName: string) => void
}

// Fields sent by "Save changes": restaurant details, branding, configuration
// (PATCH /api/businesses), then order settings (PUT …/order-settings).
const ORDER_FIELDS = ["order_notification_email", "pay_card", "pay_cash"]

const sectionId = (s: EditFocus) => `edit-section-${s}`

export function EditBusinessDialog({ business, focus, returnFocus, onOpenChange, rootDomain, onSaved, onDone }: Props) {
  const { t, fmt } = useI18n()
  const { confirm, dialog } = useConfirm()
  const [form, setForm] = useState<Record<string, string>>({})
  // What the fields held when opened (or last saved): the dirty check compares against it.
  const [baseline, setBaseline] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const openedFor = useRef<string | null>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  // The prop is already null while the close animation runs; remember whose dialog this was.
  const lastBusinessId = useRef<string | null>(null)
  useEffect(() => {
    if (business) lastBusinessId.current = business.business_id
  }, [business])

  // A save error sits at the top; the operator is usually scrolled to the footer.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [error])

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
    const initial: Record<string, string> = {
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
    }
    setForm(initial)
    setBaseline(initial)
  }, [business])

  const dirty = Object.keys(form).some((k) => (form[k] ?? "") !== (baseline[k] ?? ""))

  // Esc, the close button, clicking outside and Cancel all come through here.
  const requestClose = async () => {
    if (submitting) return
    if (dirty) {
      const ok = await confirm({
        title: t.edit.discardTitle,
        description: t.edit.discardBody,
        confirmLabel: t.edit.discardConfirm,
        destructive: true,
      })
      if (!ok) return
    }
    onOpenChange(false)
  }

  // Scroll to a section and put the cursor in its first empty field, so the
  // operator can type straight away.
  const jumpTo = useCallback((section: EditFocus) => {
    const el = document.getElementById(sectionId(section))
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "start" })
    const fields = Array.from(el.querySelectorAll<HTMLInputElement>("input:not([type=checkbox]):not([disabled])"))
    const target: HTMLElement | null =
      fields.find((f) => !f.value) ?? el.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled]), select")
    ;(target ?? el).focus({ preventScroll: true })
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
      setError(t.edit.keepOnePayment)
      return
    }

    setSubmitting(true)
    let detailsSaved = false
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
      if (!res.ok) throw new Error(fmt(t.edit.nothingSaved, { reason: apiError(t, j.error, res.status) }))
      detailsSaved = true

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
      if (!res2.ok)
        throw new Error(
          fmt(t.edit.partialSave, {
            reason: t.edit.orderErrors[j2.error] ?? j2.error ?? fmt(t.edit.requestFailedLower, { status: res2.status }),
          }),
        )

      setBaseline(form)
      onSaved()
      onOpenChange(false)
      onDone?.(form.business_name || business.business_name)
    } catch (e) {
      if (detailsSaved) {
        // Only the order fields are still unsaved; the rest now matches the server.
        setBaseline((b) => {
          const next = { ...form }
          for (const k of ORDER_FIELDS) next[k] = b[k]
          return next
        })
        onSaved()
      }
      setError(e instanceof Error && !(e instanceof TypeError) ? e.message : `${t.edit.saveFailed} ${t.common.network}`)
    } finally {
      setSubmitting(false)
    }
  }

  const readiness = business ? getReadiness(business) : null
  const hasHours = readiness?.steps.find((s) => s.key === "hours")?.done

  return (
    <Dialog open={!!business} onOpenChange={(o) => (o ? undefined : void requestClose())}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        onCloseAutoFocus={(e) => {
          // Back to the button that opened it; if the row re-rendered, its replacement.
          const target =
            (returnFocus?.isConnected ? returnFocus : null) ??
            (lastBusinessId.current
              ? // Table on wide screens, stacked list on phones: take the one on screen.
                (Array.from(document.querySelectorAll<HTMLElement>(`[data-edit-restaurant="${lastBusinessId.current}"]`)).find(
                  (el) => el.offsetParent !== null,
                ) ?? null)
              : null)
          if (target) {
            e.preventDefault()
            target.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{business ? business.business_name : t.edit.fallbackTitle}</DialogTitle>
          <DialogDescription>
            {business ? (
              <>
                {t.edit.slugLabel} <span className="font-mono">{business.slug}</span> {t.edit.slugFixed}
              </>
            ) : (
              t.edit.fallbackDescription
            )}
          </DialogDescription>
        </DialogHeader>

        {business && readiness && (
          <SetupChecklist readiness={readiness} zonesHref={`/businesses/${business.business_id}/zones`} onJump={jumpTo} />
        )}

        {error && (
          <Alert ref={errorRef} variant="destructive" className="scroll-mt-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-5">
          <Section id="details" title={t.edit.details}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.edit.name}>
                {(p) => <Input {...p} value={form.business_name ?? ""} onChange={(e) => set("business_name", e.target.value)} />}
              </Field>
              <Field label={t.edit.abbreviation}>
                {(p) => <Input {...p} value={form.name_abbreviation ?? ""} onChange={(e) => set("name_abbreviation", e.target.value)} />}
              </Field>
              <Field label={t.edit.taxId}>{(p) => <Input {...p} value={form.tax_id ?? ""} onChange={(e) => set("tax_id", e.target.value)} />}</Field>
              <Field label={t.edit.phone}>
                {(p) => <Input {...p} type="tel" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />}
              </Field>
              <Field label={t.edit.email}>
                {(p) => <Input {...p} type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />}
              </Field>
              <Field label={t.edit.address}>{(p) => <Input {...p} value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} />}</Field>
            </div>
          </Section>

          <Separator />

          {/* Domains: added, switched and removed one by one; each saves at once. */}
          <div id={sectionId("domains")} tabIndex={-1} className="scroll-mt-4 outline-none">
            {business && <DomainManager businessId={business.business_id} rootDomain={rootDomain} />}
          </div>

          <Separator />

          <Section id="branding" title={t.edit.branding} description={t.edit.brandingDescription}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.edit.smsSender} hint={t.edit.smsSenderHint}>
                {(p) => (
                  <Input {...p} value={form.sms_sender_name ?? ""} maxLength={11} onChange={(e) => set("sms_sender_name", e.target.value)} />
                )}
              </Field>
              <Field label={t.edit.emailName}>
                {(p) => (
                  <Input {...p} value={form.email_from_name ?? ""} maxLength={80} onChange={(e) => set("email_from_name", e.target.value)} />
                )}
              </Field>
            </div>
          </Section>

          <Separator />

          <Section id="orders" title={t.edit.orders}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.edit.orderEmail} hint={t.edit.orderEmailHint}>
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
                <legend className="mb-1.5 text-sm font-medium">{t.edit.paymentMethods}</legend>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={form.pay_card === "on"}
                    onChange={(e) => set("pay_card", e.target.checked ? "on" : "off")}
                  />
                  {t.edit.card} <span className="text-muted-foreground">{t.edit.cardNote}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={form.pay_cash === "on"}
                    onChange={(e) => set("pay_cash", e.target.checked ? "on" : "off")}
                  />
                  {t.edit.cash}
                </label>
                <p className="text-xs text-muted-foreground">{t.edit.keepOneOn}</p>
              </fieldset>
            </div>
            <div id={sectionId("payout")} tabIndex={-1} className="mt-4 scroll-mt-4 rounded-md border p-3 outline-none">
              <div className="mb-2 text-sm font-medium">{t.edit.payout}</div>
              {business && (
                <PayoutAccountCell businessId={business.business_id} businessName={business.business_name} account={business.payout_account ?? null} onCreated={onSaved} />
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {t.edit.payoutNote}
              </p>
            </div>
          </Section>

          <Separator />

          <Section id="staff" title={t.edit.staff}>
            {business && <StaffRolesPanel businessId={business.business_id} businessName={business.business_name} onChanged={onSaved} />}
          </Section>

          <Separator />

          <div className="scroll-mt-4">{business && <BusinessProvidersEditor businessId={business.business_id} />}</div>

          <Separator />

          <Section id="configuration" title={t.edit.configuration}>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t.edit.timezone}>{(p) => <Input {...p} value={form.timezone ?? ""} onChange={(e) => set("timezone", e.target.value)} />}</Field>
              <Field label={t.edit.currency}>
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
              <Field label={t.edit.minimumOrder}>
                {(p) => (
                  <Input {...p} type="number" step="0.01" min="0" value={form.minimum_charge ?? ""} onChange={(e) => set("minimum_charge", e.target.value)} />
                )}
              </Field>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {t.edit.hoursLabel} <span className="text-foreground">{hasHours ? t.edit.hoursSet : t.edit.hoursNotSet}</span>. {t.edit.hoursOwner}
            </p>
          </Section>
        </div>

        <DialogFooter className="sticky -bottom-6 -mb-6 border-t bg-background py-4">
          <p className="mr-auto hidden self-center text-xs text-muted-foreground sm:block">
            {t.edit.savesOnOwn}
          </p>
          <Button variant="outline" onClick={() => void requestClose()} disabled={submitting}>
            {t.common.cancel}
          </Button>
          <Button onClick={() => void handleSave()} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? t.common.saving : t.edit.saveChanges}
          </Button>
        </DialogFooter>
        {dialog}
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
