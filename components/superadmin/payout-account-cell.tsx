"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Copy, Loader2 } from "lucide-react"

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
  account,
  onCreated,
}: {
  businessId: string
  account: PayoutAccountSummary | null
  onCreated: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  if (!account) {
    const create = async () => {
      setBusy(true)
      setError("")
      try {
        const res = await fetch("/api/businesses/payout-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ business_id: businessId }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error || `Failed (${res.status})`)
        onCreated()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed")
      } finally {
        setBusy(false)
      }
    }
    return (
      <div className="flex flex-col gap-1">
        <Button size="sm" variant="outline" onClick={create} disabled={busy}>
          {busy && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Create payout account
        </Button>
        {error && <span className="text-[11px] text-destructive">{error}</span>}
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
        className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground"
        title="Copy account id"
      >
        {account.stripe_account_id}
        <Copy className="h-3 w-3" />
        {copied && <span className="font-sans text-green-700">copied</span>}
      </button>
      <div className="flex flex-wrap gap-1">
        <Badge variant={account.charges_enabled ? "secondary" : "destructive"}>
          charges {account.charges_enabled ? "on" : "off"}
        </Badge>
        <Badge variant={account.payouts_enabled ? "secondary" : "destructive"}>
          payouts {account.payouts_enabled ? "on" : "off"}
        </Badge>
        {account.outstanding_requirements > 0 && (
          <Badge variant="outline" className="border-amber-600/50 text-amber-700">
            {account.outstanding_requirements} requirement{account.outstanding_requirements === 1 ? "" : "s"} due
          </Badge>
        )}
      </div>
    </div>
  )
}
