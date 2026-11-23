import { apiError } from "@/lib/i18n/api-error"
import type { Messages } from "@/lib/i18n/messages"
import { formatEuroCents } from "@/lib/finance"

/** A friendly sentence for a finance API error, with the Edge Function's extra fields. */
export function financeError(t: Messages, body: Record<string, unknown>, status: number): string {
  const code = typeof body.error === "string" ? body.error : ""
  if (code === "insufficient_available_balance") {
    const available = body.available_cents
    const n = typeof available === "number" ? available : typeof available === "string" && /^\d+$/.test(available) ? Number(available) : null
    return n === null
      ? t.finance.errors.insufficient_available_balance_unknown
      : t.finance.errors.insufficient_available_balance.replace("{available}", formatEuroCents(n))
  }
  if (code === "stripe_rejected") {
    return t.finance.errors.stripe_rejected.replace("{code}", typeof body.code === "string" && body.code ? body.code : "—")
  }
  return t.finance.errors[code] ?? apiError(t, code, status)
}
