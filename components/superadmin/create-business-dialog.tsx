"use client"

import type React from "react"
import { useState } from "react"
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
import { CheckCircle2, Circle, Loader2 } from "lucide-react"
import { getReadiness } from "@/lib/readiness"
import { Field } from "./field"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  rootDomain: string
  onCreated: () => void
  /** "Continue setup": open the new restaurant's edit dialog. */
  onContinue: (businessId: string) => void
}

// Only what creating a restaurant needs. Everything else (contact details,
// branding, order settings, configuration) is set from the setup checklist
// in the edit dialog afterwards.
const EMPTY = {
  business_name: "",
  name_abbreviation: "",
  subdomain: "",
  slug: "",
  owner_identifier: "",
}
type Form = typeof EMPTY

/** "Trattoria da Mario" → "trattoria-da-mario", trimmed to the slug rules. */
function toSlug(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "")
}

/** "Trattoria da Mario" → "TDM". */
function toAbbreviation(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 4)
}

const SLUG_RE = /^[a-z0-9-]{3,40}$/

export function CreateBusinessDialog({ open, onOpenChange, rootDomain, onCreated, onContinue }: Props) {
  const [form, setForm] = useState<Form>({ ...EMPTY })
  // Fields the operator typed in themselves stop following the name.
  const [touched, setTouched] = useState<Partial<Record<keyof Form, boolean>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState<{ businessId: string; subdomain: string; owner: string; ownerKind: "email" | "phone" } | null>(null)

  const setName = (name: string) =>
    setForm((f) => ({
      ...f,
      business_name: name,
      name_abbreviation: touched.name_abbreviation ? f.name_abbreviation : toAbbreviation(name),
      subdomain: touched.subdomain ? f.subdomain : toSlug(name),
      slug: touched.slug ? f.slug : toSlug(name),
    }))
  const set = (k: keyof Form, v: string) => {
    setTouched((t) => ({ ...t, [k]: true }))
    setForm((f) => ({ ...f, [k]: v }))
  }

  const dirty = Object.values(form).some((v) => v.trim() !== "")
  const problems: Partial<Record<keyof Form, string>> = {
    business_name: form.business_name.trim() ? undefined : "Enter the restaurant's name.",
    name_abbreviation: form.name_abbreviation.trim() ? undefined : "Enter a short abbreviation.",
    subdomain: /^[a-z0-9-]+$/.test(form.subdomain) ? undefined : "Use lowercase letters, digits and hyphens.",
    slug: SLUG_RE.test(form.slug) ? undefined : "3–40 characters: lowercase letters, digits and hyphens.",
    owner_identifier: form.owner_identifier.trim() ? undefined : "Enter the owner's phone or email.",
  }
  const errorFor = (k: keyof Form) => (showErrors ? problems[k] : undefined)

  const reset = () => {
    setForm({ ...EMPTY })
    setTouched({})
    setError("")
    setShowErrors(false)
    setSuccess(null)
    setSubmitting(false)
  }

  const close = () => {
    onOpenChange(false)
    // Delay reset so the dialog close animation doesn't flash empty state.
    setTimeout(reset, 200)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    if (Object.values(problems).some(Boolean)) {
      setShowErrors(true)
      return
    }

    const ownerKind = form.owner_identifier.includes("@") ? "email" : "phone"
    setSubmitting(true)
    try {
      const res = await fetch("/api/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: form.business_name.trim(),
          name_abbreviation: form.name_abbreviation.trim(),
          subdomain: form.subdomain,
          slug: form.slug,
          owner_identifier: form.owner_identifier.trim(),
          owner_kind: ownerKind,
          // Defaults; the owner and the edit dialog change them later.
          timezone: "Europe/Rome",
          currency: "EUR",
          minimum_charge: 0,
          open_days_and_hours: null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`)

      setSuccess({ businessId: j.business_id, subdomain: j.subdomain, owner: form.owner_identifier.trim(), ownerKind })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the restaurant")
    } finally {
      setSubmitting(false)
    }
  }

  // What a brand-new restaurant still needs: it has an owner and a domain.
  const nextSteps = getReadiness({ readiness: { has_owner: true, sms_sender_set: false }, domains: [{ is_active: true }] }).steps

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        // Don't lose a half-filled form to a stray click outside.
        onInteractOutside={(e) => {
          if (dirty && !success) e.preventDefault()
        }}
      >
        {success ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-700" aria-hidden />
                Restaurant created
              </DialogTitle>
              <DialogDescription>The owner can sign in now with a code sent to their {success.ownerKind}. There is no password.</DialogDescription>
            </DialogHeader>
            <dl className="grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
              <dt className="text-muted-foreground">Admin panel</dt>
              <dd>
                <a
                  href={`http://${success.subdomain}.${rootDomain}/login`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium break-all text-primary underline underline-offset-2"
                >
                  {success.subdomain}.{rootDomain}/login
                </a>
              </dd>
              <dt className="text-muted-foreground">Owner {success.ownerKind === "email" ? "email" : "phone"}</dt>
              <dd className="font-medium break-all">{success.owner}</dd>
            </dl>
            <div>
              <h3 className="text-sm font-semibold">Still to do before it can take orders</h3>
              <ul className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
                {nextSteps.map((s) => (
                  <li key={s.key} className="flex items-center gap-2">
                    {s.done ? (
                      <CheckCircle2 className="h-4 w-4 text-green-700" aria-hidden />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />
                    )}
                    <span className={s.done ? "text-muted-foreground" : undefined}>
                      {s.label}
                      <span className="sr-only">{s.done ? ": done" : ": to do"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Later
              </Button>
              <Button
                onClick={() => {
                  onContinue(success.businessId)
                  close()
                }}
              >
                Continue setup
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>New restaurant</DialogTitle>
              <DialogDescription>
                Name, web address and first owner. You&apos;ll set branding, order settings and payouts next.
              </DialogDescription>
            </DialogHeader>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
              <Field label="Restaurant name" error={errorFor("business_name")}>
                {(p) => <Input {...p} value={form.business_name} onChange={(e) => setName(e.target.value)} autoFocus />}
              </Field>
              <Field label="Abbreviation" error={errorFor("name_abbreviation")}>
                {(p) => <Input {...p} value={form.name_abbreviation} onChange={(e) => set("name_abbreviation", e.target.value)} maxLength={8} />}
              </Field>
            </div>

            <Field
              label="Web address"
              hint="The restaurant's ordering site and admin panel. You can add its own domain later."
              error={errorFor("subdomain")}
            >
              {(p) => (
                <div className="flex items-center gap-2">
                  <Input
                    {...p}
                    value={form.subdomain}
                    onChange={(e) => set("subdomain", e.target.value.toLowerCase())}
                    className="min-w-0 flex-1 font-mono"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                  <span className="shrink-0 text-sm text-muted-foreground">.{rootDomain}</span>
                </div>
              )}
            </Field>

            <Field label="Slug" hint="Storage folders use it. It can never change." error={errorFor("slug")}>
              {(p) => (
                <Input
                  {...p}
                  value={form.slug}
                  onChange={(e) => set("slug", e.target.value.toLowerCase())}
                  maxLength={40}
                  className="font-mono"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              )}
            </Field>

            <Field
              label="Owner phone or email"
              hint="A phone number (+39 is added if missing) or an email. An existing account is reused; otherwise one is created."
              error={errorFor("owner_identifier")}
            >
              {(p) => (
                <Input
                  {...p}
                  value={form.owner_identifier}
                  onChange={(e) => set("owner_identifier", e.target.value)}
                  autoComplete="off"
                />
              )}
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {submitting ? "Creating…" : "Create restaurant"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
