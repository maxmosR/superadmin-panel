"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Copy, Loader2 } from "lucide-react"
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

/**
 * The restaurant's Stripe connected account: a create button before it
 * exists, then the acct id (copyable), charges/payouts badges and the number
 * of outstanding requirements. Status changes arrive through Stripe's
 * `account.updated` webhook; reload to see them.
 */
export function PayoutAccountCell({
  businessId,
  businessName,
  account,
  onCreated,
}: {
  businessId: string
  businessName?: string
  account: PayoutAccountSummary | null
  onCreated: () => void
}) {
  const { confirm, dialog } = useConfirm()
  const { t, fmt } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  if (!account) {
    const create = async () => {
      const ok = await confirm({
        title: fmt(t.payout.createTitle, { name: businessName ?? t.payout.thisRestaurant }),
        description: (
          <>
            <p>{t.payout.createBody1}</p>
            <p>{t.payout.createBody2}</p>
            <p>{t.payout.createBody3}</p>
          </>
        ),
        confirmLabel: t.payout.createConfirm,
      })
      if (!ok) return
      setBusy(true)
      setError("")
      try {
        const res = await fetch("/api/businesses/payout-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ business_id: businessId }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(t.payout.errors[j.error] ?? fmt(t.payout.createFailed, { reason: apiError(t, j.error, res.status) }))
        onCreated()
      } catch (e) {
        setError(e instanceof Error && !(e instanceof TypeError) ? e.message : fmt(t.payout.createFailed, { reason: t.common.network }))
      } finally {
        setBusy(false)
      }
    }
    return (
      <div className="flex flex-col items-start gap-1">
        <Button size="sm" variant="outline" onClick={() => void create()} disabled={busy}>
          {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {t.payout.create}
        </Button>
        {error && (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        )}
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
      <div className="flex flex-wrap gap-1">
        {/* "Off" is the normal state while the owner finishes Stripe onboarding: amber, not red. */}
        <Badge variant={account.charges_enabled ? "secondary" : "outline"} className={account.charges_enabled ? undefined : "border-amber-600/50 text-amber-700"}>
          {account.charges_enabled ? t.payout.chargesOn : t.payout.chargesOff}
        </Badge>
        <Badge variant={account.payouts_enabled ? "secondary" : "outline"} className={account.payouts_enabled ? undefined : "border-amber-600/50 text-amber-700"}>
          {account.payouts_enabled ? t.payout.payoutsOn : t.payout.payoutsOff}
        </Badge>
        {account.outstanding_requirements > 0 && (
          <Badge variant="outline" className="border-amber-600/50 text-amber-700">
            {t.payout.due(account.outstanding_requirements)}
          </Badge>
        )}
      </div>
    </div>
  )
}
