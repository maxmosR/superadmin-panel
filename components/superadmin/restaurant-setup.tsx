"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, Loader2, MapPinned } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getReadiness, type Readiness, type SetupStep } from "@/lib/readiness"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"
import type { Messages } from "@/lib/i18n/messages"
import { cn } from "@/lib/utils"
import { ConsoleShell, PageHead } from "./console-shell"
import { SetupChecklist, SetupSummary } from "./setup-status"
import { DomainManager } from "./domain-manager"
import { StaffRolesPanel } from "./staff-roles-panel"
import { PayoutAccountCell } from "./payout-account-cell"
import { BusinessProvidersEditor } from "./business-providers-editor"
import { Field } from "./field"
import { useConfirm } from "./confirm-dialog"
import type { BusinessRow } from "./superadmin-dashboard"

// One restaurant's setup, as a page of its own (/businesses/[id]) so it has a
// link, a back button and room to breathe. Every section saves on its own:
// field sections with their own Save button, list sections (domains, staff,
// payout account) as soon as you act. Nothing waits for a page-wide Save.

type SectionId = "details" | "domains" | "branding" | "orders" | "payout" | "staff" | "providers" | "configuration" | "zones"
const SECTIONS: SectionId[] = ["details", "domains", "branding", "orders", "payout", "staff", "providers", "configuration", "zones"]

/** The setup steps each section is responsible for (drives the menu marks). */
const STEPS_OF: Record<SectionId, SetupStep["key"][]> = {
  details: [],
  domains: ["domain"],
  branding: ["sms"],
  orders: ["order_email"],
  payout: ["payout"],
  staff: ["owner"],
  providers: [],
  configuration: ["hours"],
  zones: ["zones"],
}

// Same rule as the server (lib/roles.ts is server-only).
const SMS_SENDER_RE = /^[A-Za-z0-9 ]{3,11}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const sectionDomId = (id: SectionId) => `section-${id}`

function sectionTitle(t: Messages, id: SectionId): string {
  switch (id) {
    case "details":
      return t.edit.details
    case "domains":
      return t.domains.title
    case "branding":
      return t.edit.branding
    case "orders":
      return t.edit.orders
    case "payout":
      return t.edit.payout
    case "staff":
      return t.edit.staff
    case "providers":
      return t.providers.title
    case "configuration":
      return t.edit.configuration
    case "zones":
      return t.edit.zonesTitle
  }
}

/** done: every step done · todo: a blocking step open · later: only non-blocking steps open · none: no steps. */
function sectionState(readiness: Readiness, id: SectionId): "done" | "todo" | "later" | "none" {
  const steps = readiness.steps.filter((s) => STEPS_OF[id].includes(s.key))
  if (!steps.length) return "none"
  if (steps.every((s) => s.done)) return "done"
  return steps.some((s) => !s.done && s.blocking) ? "todo" : "later"
}

export function RestaurantSetup({ businessId, adminEmail, rootDomain }: { businessId: string; adminEmail: string | null; rootDomain: string }) {
  const { t, fmt } = useI18n()
  const { confirm, dialog } = useConfirm()
  const router = useRouter()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])

  const [row, setRow] = useState<BusinessRow | null>(null)
  const [loadError, setLoadError] = useState("")
  const [missing, setMissing] = useState(false)
  const [dirty, setDirtyMap] = useState<Partial<Record<SectionId, boolean>>>({})
  const [active, setActive] = useState<SectionId>("details")

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/businesses?business_id=${encodeURIComponent(businessId)}`, { cache: "no-store" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiError(tRef.current, j.error, res.status))
      const found = ((j.businesses ?? []) as BusinessRow[])[0] ?? null
      setLoadError("")
      setRow(found)
      setMissing(!found)
    } catch (e) {
      setLoadError(e instanceof Error && !(e instanceof TypeError) ? e.message : tRef.current.common.network)
    }
  }, [businessId])

  useEffect(() => {
    void load()
  }, [load])

  const setDirty = useCallback((id: SectionId, value: boolean) => {
    setDirtyMap((m) => (!!m[id] === value ? m : { ...m, [id]: value }))
  }, [])
  const dirtyIds = SECTIONS.filter((id) => dirty[id])
  const anyDirty = dirtyIds.length > 0

  // Leaving with unsaved fields: the browser asks on reload/close; in-app
  // links ask with the console's own dialog.
  useEffect(() => {
    if (!anyDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!a || a.target === "_blank") return
      const url = new URL(a.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      e.preventDefault()
      e.stopPropagation()
      void (async () => {
        const ok = await confirm({
          title: t.edit.leaveTitle,
          description: fmt(t.edit.leaveBody, { list: dirtyIds.map((id) => sectionTitle(t, id)).join(", ") }),
          confirmLabel: t.edit.leaveConfirm,
          destructive: true,
        })
        if (ok) {
          setDirtyMap({})
          router.push(url.pathname + url.search)
        }
      })()
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    document.addEventListener("click", onClick, true)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      document.removeEventListener("click", onClick, true)
    }
  }, [anyDirty, dirtyIds, confirm, fmt, router, t])

  // The menu follows the section in view.
  useEffect(() => {
    if (!row) return
    const els = SECTIONS.map((id) => document.getElementById(sectionDomId(id))).filter(Boolean) as HTMLElement[]
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive(top.target.id.replace("section-", "") as SectionId)
      },
      { rootMargin: "-15% 0px -70% 0px" },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [row])

  // Scroll to a section and put the cursor in its first empty field.
  const jumpTo = useCallback((id: SectionId) => {
    const el = document.getElementById(sectionDomId(id))
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "start" })
    const fields = Array.from(el.querySelectorAll<HTMLInputElement>("input:not([type=checkbox]):not([disabled])"))
    const target: HTMLElement | null =
      fields.find((f) => !f.value) ?? el.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled]), select")
    ;(target ?? el).focus({ preventScroll: true })
  }, [])

  const readiness = useMemo(() => (row ? getReadiness(row) : null), [row])
  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await fetch("/api/businesses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, ...body }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) return apiError(t, j.error, res.status)
      void load()
      return null
    },
    [businessId, load, t],
  )

  const back = (
    <Link
      href="/"
      className="mb-3 inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {t.edit.back}
    </Link>
  )

  if (loadError || missing || !row || !readiness) {
    return (
      <ConsoleShell adminEmail={adminEmail}>
        {back}
        {loadError ? (
          <Alert variant="destructive" className="max-w-xl">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{loadError}</span>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t.common.tryAgain}
              </Button>
            </AlertDescription>
          </Alert>
        ) : missing ? (
          <p className="text-sm text-muted-foreground">{t.edit.notFound}</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t.edit.loading}
          </p>
        )}
      </ConsoleShell>
    )
  }

  const zonesHref = `/businesses/${row.business_id}/zones`
  const hasHours = readiness.steps.find((s) => s.key === "hours")?.done

  return (
    <ConsoleShell adminEmail={adminEmail}>
      {back}
      <PageHead
        title={row.business_name}
        description={
          <>
            {t.edit.slugLabel} <span className="font-mono text-foreground">{row.slug}</span> · {t.edit.slugNote}
          </>
        }
      />

      <div className="grid items-start gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label={t.edit.sectionsNav} className="sticky top-6 hidden lg:block">
          <div className="mb-4 border-b pb-4">
            <SetupSummary readiness={readiness} />
          </div>
          <ul className="space-y-0.5">
            {SECTIONS.map((id) => {
              const state = sectionState(readiness, id)
              const current = active === id
              return (
                <li key={id}>
                  <a
                    href={`#${sectionDomId(id)}`}
                    aria-current={current ? "location" : undefined}
                    onClick={(e) => {
                      e.preventDefault()
                      jumpTo(id)
                    }}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      current ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {sectionTitle(t, id)}
                      {dirty[id] && (
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-600" aria-label={t.edit.unsaved} title={t.edit.unsaved} />
                      )}
                    </span>
                    <StateMark state={state} t={t} />
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          <p className="text-sm text-muted-foreground">{t.edit.saveModel}</p>

          {/* Phones and tablets: the checklist stands in for the side menu. */}
          <div className="lg:hidden">
            <SetupChecklist readiness={readiness} zonesHref={zonesHref} onJump={(s) => jumpTo(s)} />
          </div>

          <FieldSection
            id="details"
            title={t.edit.details}
            readiness={readiness}
            onDirty={setDirty}
            initial={{
              business_name: row.business_name ?? "",
              name_abbreviation: row.name_abbreviation ?? "",
              tax_id: row.tax_id ?? "",
              phone: row.phone ?? "",
              email: row.email ?? "",
              address: row.address ?? "",
            }}
            validate={(v) => ({
              business_name: v.business_name.trim() ? undefined : t.create.errors.name,
              name_abbreviation: v.name_abbreviation.trim() ? undefined : t.create.errors.abbreviation,
              email: !v.email.trim() || EMAIL_RE.test(v.email.trim()) ? undefined : t.edit.invalidEmail,
            })}
            onSave={(v) => patch(v)}
          >
            {({ v, set, err }) => (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.edit.name} error={err.business_name}>
                  {(p) => <Input {...p} value={v.business_name} onChange={(e) => set("business_name", e.target.value)} />}
                </Field>
                <Field label={t.edit.abbreviation} error={err.name_abbreviation}>
                  {(p) => <Input {...p} value={v.name_abbreviation} onChange={(e) => set("name_abbreviation", e.target.value)} />}
                </Field>
                <Field label={t.edit.taxId}>{(p) => <Input {...p} value={v.tax_id} onChange={(e) => set("tax_id", e.target.value)} />}</Field>
                <Field label={t.edit.phone}>
                  {(p) => <Input {...p} type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} />}
                </Field>
                <Field label={t.edit.email} error={err.email}>
                  {(p) => <Input {...p} type="email" value={v.email} onChange={(e) => set("email", e.target.value)} />}
                </Field>
                <Field label={t.edit.address}>{(p) => <Input {...p} value={v.address} onChange={(e) => set("address", e.target.value)} />}</Field>
              </div>
            )}
          </FieldSection>

          <Panel id="domains" title={t.domains.title} readiness={readiness} note={t.edit.appliesAtOnce}>
            <DomainManager businessId={row.business_id} rootDomain={rootDomain} showTitle={false} onChanged={() => void load()} />
          </Panel>

          <FieldSection
            id="branding"
            title={t.edit.branding}
            description={t.edit.brandingDescription}
            readiness={readiness}
            onDirty={setDirty}
            initial={{ sms_sender_name: row.sms_sender_name ?? "", email_from_name: row.email_from_name ?? "" }}
            validate={(v) => ({
              sms_sender_name: !v.sms_sender_name.trim() || SMS_SENDER_RE.test(v.sms_sender_name.trim()) ? undefined : t.edit.smsInvalid,
              email_from_name: v.email_from_name.includes("@") ? t.edit.emailNameIsEmail : undefined,
            })}
            onSave={(v) => patch(v)}
          >
            {({ v, set, err }) => (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.edit.smsSender} hint={t.edit.smsSenderHint} error={err.sms_sender_name}>
                  {(p) => <Input {...p} value={v.sms_sender_name} maxLength={11} onChange={(e) => set("sms_sender_name", e.target.value)} />}
                </Field>
                <Field label={t.edit.emailName} error={err.email_from_name}>
                  {(p) => <Input {...p} value={v.email_from_name} maxLength={80} onChange={(e) => set("email_from_name", e.target.value)} />}
                </Field>
              </div>
            )}
          </FieldSection>

          <FieldSection
            id="orders"
            title={t.edit.orders}
            readiness={readiness}
            onDirty={setDirty}
            initial={{
              order_notification_email: row.order_notification_email ?? "",
              pay_card: row.config?.payment_methods?.card === false ? "off" : "on",
              pay_cash: row.config?.payment_methods?.cash === false ? "off" : "on",
            }}
            validate={(v) => ({
              order_notification_email:
                !v.order_notification_email.trim() || EMAIL_RE.test(v.order_notification_email.trim()) ? undefined : t.edit.invalidEmail,
              pay_cash: v.pay_card === "off" && v.pay_cash === "off" ? t.edit.keepOnePayment : undefined,
            })}
            onSave={async (v) => {
              const res = await fetch("/api/businesses/order-settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  business_id: row.business_id,
                  order_notification_email: v.order_notification_email.trim() || null,
                  payment_methods: { card: v.pay_card === "on", cash: v.pay_cash === "on" },
                }),
              })
              const j = await res.json().catch(() => ({}))
              if (!res.ok) return t.edit.orderErrors[j.error] ?? apiError(t, j.error, res.status)
              void load()
              return null
            }}
          >
            {({ v, set, err }) => (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t.edit.orderEmail} hint={t.edit.orderEmailHint} error={err.order_notification_email}>
                  {(p) => (
                    <Input {...p} type="email" value={v.order_notification_email} onChange={(e) => set("order_notification_email", e.target.value)} />
                  )}
                </Field>
                <fieldset className="grid gap-2 text-sm" aria-describedby={err.pay_cash ? "pay-error" : undefined}>
                  <legend className="mb-1.5 text-sm font-medium">{t.edit.paymentMethods}</legend>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={v.pay_card === "on"}
                      onChange={(e) => set("pay_card", e.target.checked ? "on" : "off")}
                    />
                    {t.edit.card} <span className="text-muted-foreground">{t.edit.cardNote}</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={v.pay_cash === "on"}
                      aria-invalid={!!err.pay_cash}
                      onChange={(e) => set("pay_cash", e.target.checked ? "on" : "off")}
                    />
                    {t.edit.cash}
                  </label>
                  {err.pay_cash ? (
                    <p id="pay-error" className="text-xs text-destructive">
                      {err.pay_cash}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t.edit.keepOneOn}</p>
                  )}
                </fieldset>
              </div>
            )}
          </FieldSection>

          <Panel id="payout" title={t.edit.payout} readiness={readiness} note={t.edit.payoutNote}>
            <PayoutAccountCell
              businessId={row.business_id}
              businessName={row.business_name}
              account={row.payout_account ?? null}
              onCreated={() => void load()}
            />
          </Panel>

          <Panel id="staff" title={t.edit.staff} readiness={readiness} note={t.edit.appliesAtOnce}>
            <StaffRolesPanel businessId={row.business_id} businessName={row.business_name} onChanged={() => void load()} />
          </Panel>

          <Panel id="providers" title={t.providers.title} description={t.providers.businessIntro} readiness={readiness}>
            <BusinessProvidersEditor businessId={row.business_id} onDirty={(d) => setDirty("providers", d)} />
          </Panel>

          <FieldSection
            id="configuration"
            title={t.edit.configuration}
            readiness={readiness}
            onDirty={setDirty}
            initial={{
              timezone: row.config?.timezone ?? "Europe/Rome",
              currency: row.config?.currency ?? "EUR",
              minimum_charge: String(row.config?.minimum_charge ?? "0"),
            }}
            onSave={(v) => patch({ ...v, minimum_charge: Number(v.minimum_charge.replace(",", ".")) || 0 })}
            aside={
              <p className="text-sm text-muted-foreground">
                {t.edit.hoursLabel} <span className="text-foreground">{hasHours ? t.edit.hoursSet : t.edit.hoursNotSet}</span>.{" "}
                {t.edit.hoursOwner}
              </p>
            }
          >
            {({ v, set }) => (
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t.edit.timezone}>{(p) => <Input {...p} value={v.timezone} onChange={(e) => set("timezone", e.target.value)} />}</Field>
                <Field label={t.edit.currency}>
                  {(p) => (
                    <Select value={v.currency} onValueChange={(c) => set("currency", c)}>
                      <SelectTrigger id={p.id} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["EUR", "USD", "GBP", "CHF"].map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <Field label={t.edit.minimumOrder}>
                  {(p) => <Input {...p} inputMode="decimal" value={v.minimum_charge} onChange={(e) => set("minimum_charge", e.target.value)} />}
                </Field>
              </div>
            )}
          </FieldSection>

          <Panel id="zones" title={t.edit.zonesTitle} readiness={readiness}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5 text-sm">
                {row.zones?.published_version ? (
                  <p>{fmt(t.edit.zonesLive, { v: row.zones.published_version })}</p>
                ) : (
                  <p className="text-amber-700">{t.edit.zonesNone}</p>
                )}
                {row.zones?.has_draft_changes && <p className="text-muted-foreground">{t.edit.zonesDraft}</p>}
              </div>
              <Button variant="outline" asChild>
                <Link href={zonesHref}>
                  <MapPinned className="h-4 w-4" aria-hidden />
                  {t.edit.zonesOpen}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </Panel>
        </div>
      </div>
      {dialog}
    </ConsoleShell>
  )
}

function StateMark({ state, t }: { state: ReturnType<typeof sectionState>; t: Messages }) {
  if (state === "none") return null
  if (state === "done")
    return (
      <>
        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-700" aria-hidden />
        <span className="sr-only">: {t.common.done}</span>
      </>
    )
  return (
    <>
      <Circle className={cn("h-4 w-4 shrink-0", state === "todo" ? "text-amber-700" : "text-muted-foreground")} aria-hidden />
      <span className="sr-only">: {t.common.notDone}</span>
    </>
  )
}

/** The section's own setup steps, shown under its title when one is open. */
function OpenSteps({ readiness, id }: { readiness: Readiness; id: SectionId }) {
  const { t } = useI18n()
  const open = readiness.steps.filter((s) => STEPS_OF[id].includes(s.key) && !s.done)
  if (!open.length) return null
  return (
    <p className={cn("text-xs", open.some((s) => s.blocking) ? "text-amber-700" : "text-muted-foreground")}>
      {open.map((s) => t.setup.steps[s.key]).join(", ")}
      {open[0].hint ? ` · ${t.setup.hints[open[0].hint]}` : ""}
    </p>
  )
}

function Panel({
  id,
  title,
  description,
  note,
  readiness,
  children,
  footer,
}: {
  id: SectionId
  title: string
  description?: string
  note?: string
  readiness: Readiness
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  const headingId = `${sectionDomId(id)}-title`
  return (
    <section id={sectionDomId(id)} tabIndex={-1} aria-labelledby={headingId} className="scroll-mt-6 rounded-xl border bg-card outline-none">
      <div className="space-y-1 px-5 pt-5 pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id={headingId} className="text-base font-semibold">
            {title}
          </h2>
          {note && <span className="text-xs text-muted-foreground">{note}</span>}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        <OpenSteps readiness={readiness} id={id} />
      </div>
      <div className="px-5 pb-5">{children}</div>
      {footer}
    </section>
  )
}

type Values<K extends string> = Record<K, string>
type Errors<K extends string> = Partial<Record<K, string | undefined>>

/**
 * A section of plain fields with its own Save. It remembers what the server
 * last held, so "Unsaved changes" and the Save button only show when this
 * section really differs; other sections saving or the page reloading its
 * data never wipe what was typed here. Enter in a field saves the section.
 */
function FieldSection<K extends string>({
  id,
  title,
  description,
  readiness,
  initial,
  validate,
  onSave,
  onDirty,
  aside,
  children,
}: {
  id: SectionId
  title: string
  description?: string
  readiness: Readiness
  initial: Values<K>
  validate?: (v: Values<K>) => Errors<K>
  /** Returns an error sentence, or null when saved. */
  onSave: (v: Values<K>) => Promise<string | null>
  onDirty: (id: SectionId, dirty: boolean) => void
  aside?: React.ReactNode
  children: (ctx: { v: Values<K>; set: (k: K, value: string) => void; err: Errors<K> }) => React.ReactNode
}) {
  const { t } = useI18n()
  const [values, setValues] = useState<Values<K>>(initial)
  const [baseline, setBaseline] = useState<Values<K>>(initial)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState("")
  // Problems already in the stored data (an email typed as a display name)
  // show straight away; new ones wait for Save.
  const [showErrors, setShowErrors] = useState(() => !!validate && Object.values(validate(initial)).some(Boolean))
  const formRef = useRef<HTMLFormElement>(null)

  const dirty = (Object.keys(values) as K[]).some((k) => values[k] !== baseline[k])
  useEffect(() => {
    onDirty(id, dirty)
  }, [id, dirty, onDirty])

  const problems = validate ? validate(values) : {}
  const err: Errors<K> = showErrors ? problems : {}

  const set = (k: K, value: string) => {
    setValues((v) => ({ ...v, [k]: value }))
    setJustSaved(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dirty || saving) return
    setError("")
    if (Object.values(problems).some(Boolean)) {
      setShowErrors(true)
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    setSaving(true)
    try {
      const failure = await onSave(values)
      if (failure) setError(failure)
      else {
        setBaseline(values)
        setShowErrors(false)
        setJustSaved(true)
      }
    } catch {
      setError(t.common.network)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Panel
      id={id}
      title={title}
      description={description}
      readiness={readiness}
      footer={
        // The save bar appears once there's something to save (or just saved).
        (dirty || justSaved || saving) && (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t px-5 py-3">
          <p role="status" className="mr-auto text-xs">
            {dirty ? (
              <span className="text-amber-700">{t.edit.unsaved}</span>
            ) : justSaved ? (
              <span className="inline-flex items-center gap-1 text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                {t.edit.saved}
              </span>
            ) : null}
          </p>
          {dirty && (
            <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => {
              setValues(baseline)
              setShowErrors(false)
              setError("")
            }}>
              {t.common.cancel}
            </Button>
          )}
          <Button type="submit" form={`${sectionDomId(id)}-form`} size="sm" variant={dirty ? "default" : "outline"} disabled={!dirty || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {saving ? t.common.saving : t.edit.saveSection}
          </Button>
        </div>
        )
      }
    >
      <form id={`${sectionDomId(id)}-form`} ref={formRef} onSubmit={submit} noValidate className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {children({ v: values, set, err })}
        {aside}
      </form>
    </Panel>
  )
}
