import { describe, expect, it } from "vitest"
import { getReadiness, type ReadinessInput } from "@/lib/readiness"

const complete: ReadinessInput = {
  readiness: { has_owner: true, sms_sender_set: true },
  domains: [{ is_active: true }],
  order_notification_email: "ordini@example.it",
  config: { open_days_and_hours: { monday: { is_open: true } }, payment_methods: { card: true, cash: true } },
  zones: { published_version: 2, has_draft_changes: false },
  payout_account: { charges_enabled: true, payouts_enabled: true },
}

const missing = (r: ReturnType<typeof getReadiness>) => r.steps.filter((s) => !s.done).map((s) => s.key)

describe("getReadiness", () => {
  it("is ready when every step is done", () => {
    const r = getReadiness(complete)
    expect(r.ready).toBe(true)
    expect(r.done).toBe(r.total)
  })

  it("lists every step for a brand-new restaurant", () => {
    const r = getReadiness({ readiness: { has_owner: true, sms_sender_set: false }, domains: [{ is_active: true }] })
    expect(r.ready).toBe(false)
    expect(missing(r)).toEqual(["sms", "order_email", "payout", "zones", "hours"])
  })

  it("does not block on the payout account when cash on delivery is on", () => {
    const r = getReadiness({ ...complete, payout_account: null })
    expect(missing(r)).toEqual(["payout"])
    expect(r.ready).toBe(true)
  })

  it("blocks on the payout account when card is the only method", () => {
    const r = getReadiness({ ...complete, payout_account: null, config: { ...complete.config, payment_methods: { card: true, cash: false } } })
    expect(r.ready).toBe(false)
  })

  it("skips the payout account when cards are off", () => {
    const r = getReadiness({ ...complete, payout_account: null, config: { ...complete.config, payment_methods: { card: false, cash: true } } })
    expect(missing(r)).toEqual([])
  })

  it("needs zones published, and flags unpublished changes", () => {
    expect(getReadiness({ ...complete, zones: { published_version: null, has_draft_changes: true } }).ready).toBe(false)
    expect(getReadiness({ ...complete, zones: { published_version: 3, has_draft_changes: true } }).unpublishedZones).toBe(true)
  })

  it("counts only object-shaped opening hours, like has_opening_hours", () => {
    expect(missing(getReadiness({ ...complete, config: { ...complete.config, open_days_and_hours: [] } }))).toEqual(["hours"])
  })

  it("ignores inactive domains", () => {
    expect(missing(getReadiness({ ...complete, domains: [{ is_active: false }] }))).toEqual(["domain"])
  })
})
