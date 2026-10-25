// Shared shapes + validation for providers (see the tenant app's
// supabase/migrations/20261025010000_providers.sql). Rates are PERCENT
// (15 = 15%); fixed fees are currency.

export const CALC_MODES = ["marketplace", "payment", "cash"] as const
export type CalcMode = (typeof CALC_MODES)[number]

export const CALC_MODE_LABELS: Record<CalcMode, string> = {
  marketplace: "Marketplace — subtotal + surcharge + delivery, commission on subtotal",
  payment: "Payment — amount (+ delivery), fees on amount",
  cash: "Cash — amount only",
}

export const RATE_FIELDS = ["fee_rate", "iva_rate", "stripe_fee_rate", "stripe_fixed_fee", "tax_rate"] as const
export type RateField = (typeof RATE_FIELDS)[number]

export const RATE_LABELS: Record<RateField, string> = {
  fee_rate: "Commission (%)",
  iva_rate: "IVA on commission (%)",
  stripe_fee_rate: "Payment fee (%)",
  stripe_fixed_fee: "Fixed fee per transaction (€)",
  tax_rate: "Taxes on amount (%)",
}

export interface Provider {
  id: string
  code: string
  name: string
  calc_mode: CalcMode
  is_active: boolean
  is_mandatory: boolean
  icon_url: string | null
  sort_order: number
  default_fee_rate: number
  default_iva_rate: number
  default_stripe_fee_rate: number
  default_stripe_fixed_fee: number
  default_tax_rate: number
  default_customer_service_number: string | null
}

/** One row of business_provider_settings(business_id). */
export interface BusinessProviderSetting {
  provider_id: string
  code: string
  name: string
  calc_mode: CalcMode
  is_active: boolean
  is_mandatory: boolean
  is_enabled: boolean
  tax_locked: boolean
  fee_rate: number
  iva_rate: number
  stripe_fee_rate: number
  stripe_fixed_fee: number
  tax_rate: number
  customer_service_number: string | null
  own_fee_rate: number | null
  own_iva_rate: number | null
  own_stripe_fee_rate: number | null
  own_stripe_fixed_fee: number | null
  own_tax_rate: number | null
  own_customer_service_number: string | null
  default_fee_rate: number
  default_iva_rate: number
  default_stripe_fee_rate: number
  default_stripe_fixed_fee: number
  default_tax_rate: number
  default_customer_service_number: string | null
}

export const CODE_RE = /^[a-z0-9_]{2,40}$/
export const PHONE_RE = /^[0-9+*#() .-]{3,32}$/

/**
 * Parse a rate from user input. "" / null → null (only allowed when
 * `nullable`). Throws a readable message when out of range.
 */
export function parseRate(field: RateField, v: unknown, nullable: boolean): number | null {
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) {
    if (nullable) return null
    throw new Error(`${RATE_LABELS[field]} is required`)
  }
  const n = Number(typeof v === "string" ? v.replace(",", ".") : v)
  const max = field === "stripe_fixed_fee" ? 100000 : 100
  if (!Number.isFinite(n) || n < 0 || n > max) {
    throw new Error(`${RATE_LABELS[field]} must be between 0 and ${field === "stripe_fixed_fee" ? "any amount" : "100"}`)
  }
  return n
}

export function parsePhone(v: unknown): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  if (!PHONE_RE.test(s)) throw new Error("Customer service number: digits, spaces and + * # ( ) - only (3–32 characters)")
  return s
}
