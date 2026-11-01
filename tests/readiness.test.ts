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

describe("readiness stages and data problems", () => {
  it("is nearly ready with one blocking step left", () => {
    const r = getReadiness({ ...complete, readiness: { has_owner: true, sms_sender_set: false } })
    expect(r.stage).toBe("nearly")
    expect(r.openBlocking).toBe(1)
  })

  it("is blocked with two or more blocking steps left", () => {
    const r = getReadiness({ readiness: { has_owner: true, sms_sender_set: false }, domains: [{ is_active: true }] })
    expect(r.stage).toBe("blocked")
    expect(r.openBlocking).toBeGreaterThan(1)
  })

  it("is ready when every blocking step is done", () => {
    expect(getReadiness(complete).stage).toBe("ready")
  })

  it("flags an email address typed as the email display name", () => {
    const r = getReadiness({ ...complete, email_from_name: "owner@example.it" })
    expect(r.problems).toEqual([{ key: "email_name_is_email", section: "branding" }])
    // A data problem doesn't stop orders.
    expect(r.ready).toBe(true)
  })

  it("flags an SMS sender the provider would refuse, and accepts a valid one", () => {
    expect(getReadiness({ ...complete, sms_sender_name: "Pizzeria-Da-Mario!" }).problems.map((p) => p.key)).toEqual(["sms_sender_invalid"])
    expect(getReadiness({ ...complete, sms_sender_name: "DaMario", email_from_name: "Da Mario" }).problems).toEqual([])
  })
})
