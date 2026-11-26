"use client"

import { useId, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { CheckCircle2, Copy, Loader2, RefreshCw } from "lucide-react"
import { useConfirm } from "./confirm-dialog"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"

export interface PayoutAccountSummary {
  stripe_account_id: string
  charges_enabled: boolean
  payouts_enabled: boolean
  details_submitted: boolean
  outstanding_requirements: number
}

const ACCOUNT_ID_RE = /^acct_[A-Za-z0-9]{6,}$/

/**
 * The restaurant's Stripe connected account. BirraOra never creates one: the
 * operator creates and verifies it in the Stripe Dashboard, then pastes its
 * acct_ id here. Once linked: the id (copyable), one charges/payouts answer,
 * outstanding requirements, "Refresh from Stripe" (re-sends the same id, which
 * re-reads its status) and "Change" (link another id). Status changes also
 * arrive by themselves through Stripe's `account.updated` webhook.
 */
export function PayoutAccountCell({
  businessId,
  businessName,
  account,
  onChanged,
}: {
  businessId: string
  businessName?: string
  account: PayoutAccountSummary | null
  onChanged: () => void
}) {
  const { confirm, dialog } = useConfirm()
  const { t, fmt } = useI18n()
  const inputId = useId()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState<"link" | "refresh" | null>(null)
  const [error, setError] = useState("")
  const [note, setNote] = useState("")
  const [copied, setCopied] = useState(false)

  const send = async (accountId: string, kind: "link" | "refresh") => {
    setBusy(kind)
    setError("")
    setNote("")
    try {
      const res = await fetch("/api/businesses/payout-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, stripe_account_id: accountId }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(t.payout.errors[j.error] ?? fmt(t.payout.linkFailed, { reason: apiError(t, j.error, res.status) }))
      setEditing(false)
      setValue("")
      if (kind === "refresh") setNote(t.payout.refreshed)
      onChanged()
    } catch (e) {
      setError(e instanceof Error && !(e instanceof TypeError) ? e.message : fmt(t.payout.linkFailed, { reason: t.common.network }))
    } finally {
      setBusy(null)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const id = value.trim()
    if (!ACCOUNT_ID_RE.test(id)) {
      setError(t.payout.errors.invalid_account_id)
      return
    }
    if (account && account.stripe_account_id !== id) {
      const ok = await confirm({
        title: fmt(t.payout.replaceTitle, { name: businessName ?? t.payout.thisRestaurant }),
        description: (
          <>
            <p>{fmt(t.payout.replaceBody1, { id, old: account.stripe_account_id })}</p>
            <p>{t.payout.replaceBody2}</p>
          </>
        ),
        confirmLabel: t.payout.replaceConfirm,
      })
      if (!ok) return
    }
    await send(id, "link")
  }

  const form = (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col items-start gap-1.5">
      <label htmlFor={inputId} className="text-xs font-medium">
        {t.payout.inputLabel}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={inputId}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError("")
          }}
          placeholder="acct_…"
          autoComplete="off"
          spellCheck={false}
          className="h-8 w-56 font-mono text-xs"
          aria-invalid={error ? true : undefined}
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy !== null || !value.trim()}>
          {busy === "link" && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {t.payout.link}
        </Button>
        {account && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false)
              setValue("")
              setError("")
            }}
          >
            {t.payout.cancel}
          </Button>
        )}
      </div>
      <p className="max-w-sm text-xs text-muted-foreground">{t.payout.inputHint}</p>
    </form>
  )

  const errorLine = error ? (
    <span className="max-w-sm text-xs text-destructive" role="alert">
      {error}
    </span>
  ) : null

  if (!account) {
    return (
      <div className="flex flex-col items-start gap-1">
        {form}
        {errorLine}
        {dialog}
      </div>
    )
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account.stripe_account_id)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked: the id is still visible and selectable.
    }
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      <button
        type="button"
        onClick={copy}
        className="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
        title={t.payout.copyTitle}
        aria-label={fmt(t.payout.copyLabel, { id: account.stripe_account_id })}
      >
        {account.stripe_account_id}
        <Copy className="h-3 w-3" aria-hidden />
        <span className="font-sans text-green-700" aria-live="polite">
          {copied ? t.payout.copied : ""}
        </span>
      </button>
      {/* One answer to "can this restaurant take cards?". Quiet when yes;
          amber with what's missing while Stripe hasn't enabled the account. */}
      {account.charges_enabled && account.payouts_enabled ? (
        <div className="space-y-0.5">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            {t.payout.cardsOn}
          </span>
          {/* Stripe can ask for more documents later; cards keep working until its deadline. */}
          {account.outstanding_requirements > 0 && (
            <p className="text-xs text-amber-700">{t.payout.due(account.outstanding_requirements)}</p>
          )}
        </div>
      ) : (
        <div className="space-y-0.5">
          <Badge variant="outline" className="border-amber-600/50 text-amber-700">
            {t.payout.cardsWaiting}
          </Badge>
          <p className="text-xs text-muted-foreground">
            {[
              account.charges_enabled ? null : t.payout.chargesOff,
              account.payouts_enabled ? null : t.payout.payoutsOff,
              account.outstanding_requirements > 0 ? t.payout.due(account.outstanding_requirements) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}
      {editing ? (
        form
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={busy !== null}
            onClick={() => void send(account.stripe_account_id, "refresh")}
          >
            {busy === "refresh" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
            {t.payout.refresh}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={busy !== null}
            onClick={() => {
              setEditing(true)
              setNote("")
            }}
          >
            {t.payout.change}
          </Button>
          <span className="text-green-700" aria-live="polite">
            {note}
          </span>
        </div>
      )}
      {errorLine}
      {dialog}
    </div>
  )
}
