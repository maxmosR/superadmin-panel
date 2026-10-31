// What a restaurant still needs before it can take orders.
//
// Mirrors the storefront's `restaurant_can_take_orders` (zone set, order
// email, a usable payment method, card needs a ready payout account) plus the
// console's own prerequisites: an owner who can sign in, an active domain and
// an SMS sender for sign-in codes. Opening hours are set by the owner in the
// restaurant's admin panel, so that step has no action here.

export type SetupSection = "staff" | "domains" | "branding" | "orders"

export type SetupAction =
  | { kind: "edit"; section: SetupSection }
  | { kind: "payout" }
  | { kind: "zones" }
  | { kind: "owner" }

export interface SetupStep {
  key: "owner" | "domain" | "sms" | "order_email" | "payout" | "zones" | "hours"
  label: string
  done: boolean
  /** False when the restaurant can still take some orders without it. */
  blocking: boolean
  /** Shown under the step when it is not done. */
  hint?: string
  action: SetupAction
}

export interface ReadinessInput {
  readiness?: { has_owner: boolean; sms_sender_set: boolean } | null
  domains?: { is_active: boolean }[] | null
  order_notification_email?: string | null
  config?: {
    open_days_and_hours?: unknown | null
    payment_methods?: { card?: boolean; cash?: boolean } | null
  } | null
  zones?: { published_version: number | null; has_draft_changes: boolean } | null
  payout_account?: { charges_enabled: boolean; payouts_enabled: boolean } | null
}

export interface Readiness {
  steps: SetupStep[]
  done: number
  total: number
  /** Every blocking step is done: customers can order. */
  ready: boolean
  /** Zones are live but the draft has changes nobody published. */
  unpublishedZones: boolean
}

export function getReadiness(b: ReadinessInput): Readiness {
  // Same defaults as the backend: both methods on when nothing is stored.
  const card = b.config?.payment_methods?.card !== false
  const cash = b.config?.payment_methods?.cash !== false
  const payoutReady = !!(b.payout_account?.charges_enabled && b.payout_account?.payouts_enabled)
  const hours = b.config?.open_days_and_hours
  const hasHours = typeof hours === "object" && hours !== null && !Array.isArray(hours)

  const steps: SetupStep[] = [
    {
      key: "owner",
      label: "Owner",
      done: !!b.readiness?.has_owner,
      blocking: true,
      action: { kind: "edit", section: "staff" },
    },
    {
      key: "domain",
      label: "Active domain",
      done: !!b.domains?.some((d) => d.is_active),
      blocking: true,
      action: { kind: "edit", section: "domains" },
    },
    {
      key: "sms",
      label: "SMS sender",
      done: !!b.readiness?.sms_sender_set,
      blocking: true,
      hint: "Register the name at OpenAPI.com first.",
      action: { kind: "edit", section: "branding" },
    },
    {
      key: "order_email",
      label: "Order email",
      done: !!b.order_notification_email,
      blocking: true,
      action: { kind: "edit", section: "orders" },
    },
    {
      key: "payout",
      label: "Payout account",
      // Not needed when the restaurant doesn't take cards.
      done: !card || payoutReady,
      // With cash on delivery the restaurant can still take orders.
      blocking: card && !cash,
      hint: b.payout_account ? "Waiting for Stripe to enable charges and payouts." : "Needed for card payments.",
      action: { kind: "payout" },
    },
    {
      key: "zones",
      label: "Delivery zones",
      done: !!b.zones?.published_version,
      blocking: true,
      action: { kind: "zones" },
    },
    {
      key: "hours",
      label: "Opening hours",
      done: hasHours,
      blocking: true,
      hint: "The owner sets them in the restaurant's admin panel.",
      action: { kind: "owner" },
    },
  ]

  const done = steps.filter((s) => s.done).length
  return {
    steps,
    done,
    total: steps.length,
    ready: steps.every((s) => s.done || !s.blocking) && (cash || payoutReady),
    unpublishedZones: !!(b.zones?.published_version && b.zones.has_draft_changes),
  }
}
