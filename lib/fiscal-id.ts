// The restaurant's own Italian fiscal id, used as the OpenAPI `fiscal_id`
// for its receipts (business_fiscal_settings.fiscal_id). Pure, unit-tested.
//
// Accepted, after removing spaces and upper-casing:
// - Partita IVA: 11 digits with a valid check digit;
// - codice fiscale (sole traders): 16 letters/digits with a valid check letter.

/** Partita IVA check digit (Luhn-style, as published by the Agenzia delle Entrate). */
export function isValidPartitaIva(v: string): boolean {
  if (!/^[0-9]{11}$/.test(v)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) {
    let d = v.charCodeAt(i) - 48
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return (10 - (sum % 10)) % 10 === v.charCodeAt(10) - 48
}

// Values of characters in odd (1st, 3rd, …) positions of a codice fiscale.
const ODD: Record<string, number> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
}

/** 16-character codice fiscale, check letter included. */
export function isValidCodiceFiscale(v: string): boolean {
  if (!/^[A-Z0-9]{16}$/.test(v)) return false
  let sum = 0
  for (let i = 0; i < 15; i++) {
    const c = v[i]
    if (i % 2 === 0) sum += ODD[c]
    else sum += /[0-9]/.test(c) ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 65
  }
  return String.fromCharCode(65 + (sum % 26)) === v[15]
}

export type FiscalIdResult = { ok: true; value: string } | { ok: false }

export function parseFiscalId(raw: unknown): FiscalIdResult {
  if (typeof raw !== "string") return { ok: false }
  const v = raw.replace(/\s+/g, "").toUpperCase()
  if (isValidPartitaIva(v) || isValidCodiceFiscale(v)) return { ok: true, value: v }
  return { ok: false }
}
