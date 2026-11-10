"use client"

import type React from "react"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Loader2 } from "lucide-react"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"

// Sets a staff member's sign-in email (PUT /api/businesses/staff-email).
export function StaffEmailDialog({
  open,
  onOpenChange,
  businessId,
  userId,
  who,
  maskedEmail,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  businessId: string
  userId: string
  who: string
  maskedEmail: string | null
  onChanged: () => void
}) {
  const { t, fmt } = useI18n()
  const inputId = useId()
  const [email, setEmail] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const close = (next: boolean) => {
    if (saving) return
    if (!next) {
      setEmail("")
      setError("")
    }
    onOpenChange(next)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/businesses/staff-email", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, user_id: userId, email: email.trim() }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          j.error
            ? apiError(t, j.error, res.status, { email_taken: t.staff.emailTaken, invalid_email: t.staff.invalidEmail })
            : t.staff.saveFailed,
        )
        return
      }
      setEmail("")
      onOpenChange(false)
      onChanged()
    } catch {
      setError(t.common.network)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{fmt(t.staff.emailTitle, { who })}</DialogTitle>
            <DialogDescription>{t.staff.emailBody}</DialogDescription>
          </DialogHeader>
          {maskedEmail && <p className="font-mono text-xs text-muted-foreground">{fmt(t.staff.emailCurrent, { email: maskedEmail })}</p>}
          <div className="space-y-1.5">
            <Label htmlFor={inputId}>{t.staff.emailNew}</Label>
            <Input
              id={inputId}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={saving}
              required
            />
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={saving}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={saving || !email.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t.staff.emailSave}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
