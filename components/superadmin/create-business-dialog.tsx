"use client"

import { useState } from "react"
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
import { CheckCircle2, Loader2 } from "lucide-react"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  rootDomain: string
  onCreated: () => void
}

const EMPTY = {
  business_name: "",
  name_abbreviation: "",
  tax_id: "",
  address: "",
  phone: "",
  email: "",
  subdomain: "",
  slug: "",
  sms_sender_name: "",
  email_from_name: "",
  owner_identifier: "",
  timezone: "Europe/Rome",
  currency: "EUR",
  minimum_charge: "0",
  max_concurrent_appointments: "6",
  open_days_and_hours: "",
}

export function CreateBusinessDialog({ open, onOpenChange, rootDomain, onCreated }: Props) {
  const [form, setForm] = useState({ ...EMPTY })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState<{ subdomain: string; owner: string } | null>(null)

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const reset = () => {
    setForm({ ...EMPTY })
    setError("")
    setSuccess(null)
    setSubmitting(false)
  }

  const close = () => {
    onOpenChange(false)
    // Delay reset so the dialog close animation doesn't flash empty state.
    setTimeout(reset, 200)
  }

  const handleSubmit = async () => {
    setError("")

    // Parse optional open hours JSON.
    let openHours: unknown = null
    if (form.open_days_and_hours.trim()) {
      try {
        openHours = JSON.parse(form.open_days_and_hours)
      } catch {
        setError("Open days & hours must be valid JSON (or leave it empty).")
        return
      }
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: form.business_name,
          name_abbreviation: form.name_abbreviation,
          tax_id: form.tax_id || null,
          address: form.address || null,
          phone: form.phone || null,
          email: form.email || null,
          subdomain: form.subdomain,
          slug: form.slug,
          sms_sender_name: form.sms_sender_name || null,
          email_from_name: form.email_from_name || null,
          owner_identifier: form.owner_identifier,
          owner_kind: form.owner_identifier.includes("@") ? "email" : "phone",
          timezone: form.timezone,
          currency: form.currency,
          minimum_charge: Number(form.minimum_charge) || 0,
          max_concurrent_appointments: Number(form.max_concurrent_appointments) || 6,
          open_days_and_hours: openHours,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`)

      setSuccess({ subdomain: j.subdomain, owner: form.owner_identifier })
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create business")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {success ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Business created
              </DialogTitle>
              <DialogDescription>The owner can now sign in at their subdomain.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 rounded-md border p-4 text-sm">
              <div>
                <div className="text-muted-foreground">Dashboard URL</div>
                <a
                  href={`http://${success.subdomain}.${rootDomain}/login`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline underline-offset-2"
                >
                  {success.subdomain}.{rootDomain}/login
                </a>
              </div>
              <div>
                <div className="text-muted-foreground">Owner email</div>
                <div className="font-medium">{success.owner}</div>
              </div>
              <p className="text-xs text-muted-foreground">
                The owner signs in with a one-time code sent to this phone or email. There is no password.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create business</DialogTitle>
              <DialogDescription>Provision a new business, its slug and subdomain, and its first owner.</DialogDescription>
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
                    <Input value={form.business_name} onChange={(e) => set("business_name", e.target.value)} />
                  </Field>
                  <Field label="Abbreviation *">
                    <Input value={form.name_abbreviation} onChange={(e) => set("name_abbreviation", e.target.value)} />
                  </Field>
                  <Field label="Tax ID">
                    <Input value={form.tax_id} onChange={(e) => set("tax_id", e.target.value)} />
                  </Field>
                  <Field label="Phone">
                    <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                  </Field>
                  <Field label="Business email">
                    <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
                  </Field>
                  <Field label="Address">
                    <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
                  </Field>
                </div>
              </section>

              <Separator />

              {/* Subdomain */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">Subdomain</h3>
                <Field label="Subdomain *">
                  <div className="flex items-center gap-2">
                    <Input
                      value={form.subdomain}
                      onChange={(e) => set("subdomain", e.target.value.toLowerCase())}
                      placeholder="acme"
                      className="max-w-[200px]"
                    />
                    <span className="text-sm text-muted-foreground">.{rootDomain}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Lowercase letters, digits and hyphens only.</p>
                </Field>
              </section>

              <Separator />

              {/* Slug and branding */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">Slug and branding</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Slug *">
                    <Input
                      value={form.slug}
                      onChange={(e) => set("slug", e.target.value.toLowerCase())}
                      placeholder="acme"
                      maxLength={40}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      3–40 characters: a-z, 0-9, -. Storage folders use it. It can never change.
                    </p>
                  </Field>
                  <Field label="SMS sender name">
                    <Input
                      value={form.sms_sender_name}
                      onChange={(e) => set("sms_sender_name", e.target.value)}
                      placeholder="Acme"
                      maxLength={11}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      3–11 letters, digits, spaces. Register it at OpenAPI.com first.
                    </p>
                  </Field>
                  <Field label="Email display name">
                    <Input value={form.email_from_name} onChange={(e) => set("email_from_name", e.target.value)} maxLength={80} />
                  </Field>
                </div>
              </section>

              <Separator />

              {/* Owner */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">Owner</h3>
                <Field label="Owner phone or email *">
                  <Input
                    value={form.owner_identifier}
                    onChange={(e) => set("owner_identifier", e.target.value)}
                    placeholder="+39 333 123 4567 or owner@example.com"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    An existing account is reused; otherwise one is created. The owner signs in with a code.
                  </p>
                </Field>
              </section>

              <Separator />

              {/* Configuration */}
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground">Configuration</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Timezone">
                    <Input value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />
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
                      value={form.minimum_charge}
                      onChange={(e) => set("minimum_charge", e.target.value)}
                    />
                  </Field>
                  <Field label="Max concurrent appointments">
                    <Input
                      type="number"
                      value={form.max_concurrent_appointments}
                      onChange={(e) => set("max_concurrent_appointments", e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Open days & hours (JSON, optional)">
                  <textarea
                    value={form.open_days_and_hours}
                    onChange={(e) => set("open_days_and_hours", e.target.value)}
                    placeholder='e.g. {"mon":["09:00-18:00"],"tue":["09:00-18:00"]}'
                    rows={3}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Leave empty to let the owner set hours later.</p>
                </Field>
              </section>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Create business"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
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
