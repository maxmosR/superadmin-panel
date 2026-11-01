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
  /** Also the key of the step's name in the strings (setup.steps). */
  key: "owner" | "domain" | "sms" | "order_email" | "payout" | "zones" | "hours"
  done: boolean
  /** False when the restaurant can still take some orders without it. */
  blocking: boolean
  /** Shown under the step when it is not done (key into setup.hints). */
  hint?: "sms" | "payoutWaiting" | "payoutCard" | "hours"
  action: SetupAction
}

/**
 * Something stored on the restaurant that is set but wrong. It doesn't stop
 * orders, but customers would see it, so the console flags it next to the
 * missing steps. `section` is where it is fixed.
 */
export interface DataProblem {
  key: "email_name_is_email" | "sms_sender_invalid"
  section: SetupSection
}

// Same rule as the server's SMS_SENDER_RE (lib/roles.ts is server-only).
const SMS_SENDER_RE = /^[A-Za-z0-9 ]{3,11}$/

export interface ReadinessInput {
  readiness?: { has_owner: boolean; sms_sender_set: boolean } | null
  sms_sender_name?: string | null
  email_from_name?: string | null
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
  /** Blocking steps still open. */
  openBlocking: number
  /** For sorting and filtering: ready, one blocking step left, or more. */
  stage: "ready" | "nearly" | "blocked"
  /** Set but wrong values (see DataProblem). */
  problems: DataProblem[]
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
      done: !!b.readiness?.has_owner,
      blocking: true,
      action: { kind: "edit", section: "staff" },
    },
    {
      key: "domain",
      done: !!b.domains?.some((d) => d.is_active),
      blocking: true,
      action: { kind: "edit", section: "domains" },
    },
    {
      key: "sms",
      done: !!b.readiness?.sms_sender_set,
      blocking: true,
      hint: "sms",
      action: { kind: "edit", section: "branding" },
    },
    {
      key: "order_email",
      done: !!b.order_notification_email,
      blocking: true,
      action: { kind: "edit", section: "orders" },
    },
    {
      key: "payout",
      // Not needed when the restaurant doesn't take cards.
      done: !card || payoutReady,
      // With cash on delivery the restaurant can still take orders.
      blocking: card && !cash,
      hint: b.payout_account ? "payoutWaiting" : "payoutCard",
      action: { kind: "payout" },
    },
    {
      key: "zones",
      done: !!b.zones?.published_version,
      blocking: true,
      action: { kind: "zones" },
    },
    {
      key: "hours",
      done: hasHours,
      blocking: true,
      hint: "hours",
      action: { kind: "owner" },
    },
  ]

  const done = steps.filter((s) => s.done).length
  const ready = steps.every((s) => s.done || !s.blocking) && (cash || payoutReady)
  const openBlocking = steps.filter((s) => !s.done && s.blocking).length

  const problems: DataProblem[] = []
  const emailName = b.email_from_name?.trim()
  if (emailName && emailName.includes("@")) problems.push({ key: "email_name_is_email", section: "branding" })
  const sms = b.sms_sender_name?.trim()
  if (sms && !SMS_SENDER_RE.test(sms)) problems.push({ key: "sms_sender_invalid", section: "branding" })

  return {
    steps,
    done,
    total: steps.length,
    ready,
    openBlocking,
    stage: ready ? "ready" : openBlocking <= 1 ? "nearly" : "blocked",
    problems,
    unpublishedZones: !!(b.zones?.published_version && b.zones.has_draft_changes),
  }
}
