import { describe, expect, it } from "vitest"
import { isValidCodiceFiscale, isValidPartitaIva, parseFiscalId } from "@/lib/fiscal-id"
import { groupPairingCode } from "@/lib/order-devices"

describe("parseFiscalId", () => {
  it("accepts a Partita IVA with a valid check digit", () => {
    expect(parseFiscalId("01234567897")).toEqual({ ok: true, value: "01234567897" })
    expect(parseFiscalId(" 012 345 678 97 ")).toEqual({ ok: true, value: "01234567897" })
  })

  it("refuses a Partita IVA with a wrong check digit or length", () => {
    expect(isValidPartitaIva("01234567890")).toBe(false)
    expect(parseFiscalId("0123456789").ok).toBe(false)
    expect(parseFiscalId("IT01234567897").ok).toBe(false)
  })

  it("accepts a codice fiscale, upper-cased", () => {
    expect(parseFiscalId("rssmra80a01h501u")).toEqual({ ok: true, value: "RSSMRA80A01H501U" })
  })

  it("refuses a codice fiscale with a wrong check letter or bad characters", () => {
    expect(isValidCodiceFiscale("RSSMRA80A01H501A")).toBe(false)
    expect(parseFiscalId("RSSMRA80A01H501-").ok).toBe(false)
    expect(parseFiscalId(12345678901).ok).toBe(false)
    expect(parseFiscalId("").ok).toBe(false)
  })
})

describe("groupPairingCode", () => {
  it("groups a 10-character code as XXXXX-XXXXX", () => {
    expect(groupPairingCode("abcde12345")).toBe("ABCDE-12345")
    expect(groupPairingCode("ABCDE-12345")).toBe("ABCDE-12345")
  })
})
