import { describe, expect, it } from "vitest"
import {
  isTimeZone,
  parseConfigFields,
  parseContactFields,
  parseCurrency,
  parseHttpsUrl,
  parseOpenDaysAndHours,
} from "@/lib/business-fields"

describe("parseHttpsUrl", () => {
  it.each(["https://cdn.example.com/logo.png", "https://x.supabase.co/storage/v1/object/public/a/b.webp?v=2"])("accepts %s", (u) => {
    expect(parseHttpsUrl(u)).toBe(u)
  })
  it.each(["http://x.com/a.png", "javascript:alert(1)", "data:image/png;base64,AAAA", "https://user:pw@x.com/a.png", "/logo.png", "x".repeat(10), 1, {}])(
    "refuses %j",
    (u) => {
      expect(parseHttpsUrl(u)).toBeUndefined()
    },
  )
  it("clears on empty / null", () => {
    expect(parseHttpsUrl("  ")).toBeNull()
    expect(parseHttpsUrl(null)).toBeNull()
  })
  it("refuses over-long URLs", () => {
    expect(parseHttpsUrl(`https://x.com/${"a".repeat(2048)}`)).toBeUndefined()
  })
})

describe("isTimeZone / parseCurrency", () => {
  it.each(["Europe/Rome", "UTC", "America/Argentina/Buenos_Aires", "Etc/GMT+1"])("accepts zone %s", (z) => expect(isTimeZone(z)).toBe(true))
  it.each(["Mars/Olympus", "rome", "+01:00", "Europe/Rome; drop", "", 5])("refuses zone %j", (z) => expect(isTimeZone(z)).toBe(false))
  it("currency: three letters, upper-cased", () => {
    expect(parseCurrency("eur")).toBe("EUR")
    expect(parseCurrency("EURO")).toBeUndefined()
    expect(parseCurrency("E1R")).toBeUndefined()
    expect(parseCurrency(978)).toBeUndefined()
  })
})

describe("parseOpenDaysAndHours", () => {
  it("accepts both shapes the apps read", () => {
    const current = { monday: { is_open: true, open: "18:00", close: "02:00+1" }, sunday: { is_open: false, open: "09:00", close: "17:00" } }
    const legacy = { friday: { is_open: true, slots: [{ open: "12:00", close: "15:00" }, { open: "19:00", close: "01:00", close_in_the_day_after: true }] } }
    expect(parseOpenDaysAndHours(current)).toEqual(current)
    expect(parseOpenDaysAndHours(legacy)).toEqual(legacy)
    expect(parseOpenDaysAndHours(null)).toBeNull()
  })
  it.each([
    [[]],
    ["mon-fri"],
    [{ holiday: { is_open: true } }],
    [{ monday: "open" }],
    [{ monday: { is_open: "yes" } }],
    [{ monday: { is_open: true, open: "9:00", close: "17:00" } }],
    [{ monday: { is_open: true, open: "09:00+1", close: "17:00" } }],
    [{ monday: { is_open: true, open: "09:00", close: "17:00", note: "<script>" } }],
    [{ monday: { is_open: true, slots: Array.from({ length: 7 }, () => ({ open: "09:00", close: "10:00" })) } }],
    [{ monday: { is_open: true, slots: [{ open: "09:00", close: "10:00", extra: 1 }] } }],
  ])("refuses %j", (v) => {
    expect(parseOpenDaysAndHours(v)).toBeUndefined()
  })
})

describe("body parsers", () => {
  it("only touches present keys and names the bad field", () => {
    expect(parseContactFields({ address: " Via Roma 1 ", phone: "" })).toEqual({ ok: true, values: { address: "Via Roma 1", phone: null } })
    expect(parseContactFields({ email: "a@b" })).toEqual({ ok: false, error: "invalid_email" })
    expect(parseContactFields({ tax_id: "IT 01234567890" })).toEqual({ ok: true, values: { tax_id: "IT 01234567890" } })
    expect(parseContactFields({ address: "line\u0000break" })).toEqual({ ok: false, error: "invalid_address" })
  })
  it("defaults an empty timezone / currency as before", () => {
    expect(parseConfigFields({ timezone: "", currency: null })).toEqual({ ok: true, values: { timezone: "Europe/Rome", currency: "EUR" } })
    expect(parseConfigFields({})).toEqual({ ok: true, values: {} })
  })
})
