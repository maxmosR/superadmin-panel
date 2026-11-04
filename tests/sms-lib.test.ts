import { describe, expect, it } from "vitest"
import { currentAlias, maskPhone, nextDay, purposeLabel, rangeFromParams, romeDayStart, romeMonthStartDay } from "@/lib/sms"
import { parseWhatsapp } from "@/lib/roles"

describe("SMS screen helpers", () => {
  it("masks phones to the country code and last 3 digits", () => {
    expect(maskPhone("+393331112222")).toBe("+39 ••• ••222")
    expect(maskPhone(null)).toBeNull()
    expect(maskPhone("+12")).toBe("•••")
  })

  it("labels purposes as login / checkout", () => {
    expect(purposeLabel("sign_in")).toBe("Login")
    expect(purposeLabel("phone_change")).toBe("Checkout")
  })

  it("picks the live alias, else the newest", () => {
    const a = (state: string, updated_at: string) => ({ state: state as never, updated_at })
    expect(currentAlias([a("REJECTED", "2026-11-03"), a("PENDING", "2026-11-01")])?.state).toBe("PENDING")
    expect(currentAlias([a("REJECTED", "2026-11-01"), a("DELETED", "2026-11-03")])?.state).toBe("DELETED")
    expect(currentAlias([])).toBeNull()
  })

  it("turns Rome days into [from, to) timestamps, DST included", () => {
    expect(romeDayStart("2026-01-15")).toBe("2026-01-15T00:00:00+01:00")
    expect(romeDayStart("2026-07-15")).toBe("2026-07-15T00:00:00+02:00")
    expect(romeDayStart("2026-13-01")).toBeNull()
    expect(nextDay("2026-12-31")).toBe("2027-01-01")
    expect(rangeFromParams("2026-11-01", "2026-11-30")).toEqual({ from: "2026-11-01T00:00:00+01:00", to: "2026-12-01T00:00:00+01:00" })
    expect(rangeFromParams(null, null)).toEqual({ from: null, to: null })
    expect(rangeFromParams("yesterday", null)).toBeUndefined()
    expect(romeMonthStartDay(new Date("2026-11-30T23:30:00Z"))).toBe("2026-12-01")
  })

  it("parses WhatsApp numbers to E.164", () => {
    expect(parseWhatsapp("+39 333 123 4567")).toBe("+393331234567")
    expect(parseWhatsapp("0039 333-123-4567")).toBe("+393331234567")
    expect(parseWhatsapp("")).toBeNull()
    expect(parseWhatsapp(null)).toBeNull()
    expect(parseWhatsapp("3331234567")).toBeUndefined()
    expect(parseWhatsapp(42)).toBeUndefined()
  })
})
