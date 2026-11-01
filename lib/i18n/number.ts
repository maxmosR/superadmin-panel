// Numbers and money in the console's language: "2,00 €" and "1,5 km" in
// Italian, "€2.00" and "1.5 km" in English. The language provider sets the
// locale as it renders. Numbers only appear after client-side data loads, so
// the module-level value never leaks between server requests in practice.

let locale = "it-IT"

export function setNumberLocale(next: string) {
  locale = next
}

export function formatNumber(n: number, digits: number): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)
}

/** Up to two decimals, none when whole: 22 -> "22", 1.4 -> "1,4". */
export function formatDecimal(n: number): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n)
}

export function formatMoney(n: number): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(n)
}
