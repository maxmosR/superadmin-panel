import { fmt } from "@/lib/i18n/core"
import type { Messages } from "@/lib/i18n/messages"
import { formatEuro } from "@/lib/zones/units"
import type { QuoteResult, ZoneIssue } from "@/lib/zones/types"

/**
 * A database check in the operator's language. The SQL words its checks in
 * English; the code picks the translation and the first number in the
 * English text fills {n}. Unknown codes keep the server's text.
 */
export function issueText(t: Messages, issue: ZoneIssue): string {
  const template = t.zones.issues[issue.code]
  if (!template) return issue.message
  const n = issue.message.match(/\d+(?:[.,]\d+)?/)?.[0] ?? ""
  return fmt(template, { n })
}

/** lib/zones messages (validation, import) in the operator's language. */
export function libText(t: Messages, text: string): string {
  const known = t.zones.lib[text]
  if (known) return known
  const field = text.match(/^Invalid field: (.+)$/)
  if (field) return fmt(t.zones.invalidField, { field: field[1] })
  const format = text.match(/^Unknown format "(.*)"\.$/)
  if (format) return fmt(t.zones.unknownFormat, { format: format[1] })
  return text
}

/** What a quote means for a customer, for display. */
export function quoteText(t: Messages, q: QuoteResult | null): string {
  if (!q) return "—"
  if (q.status === "ok") return q.min_order ? `${formatEuro(q.fee)} · ${fmt(t.zones.quote.min, { v: formatEuro(q.min_order) })}` : formatEuro(q.fee)
  return t.zones.quote[q.status]
}
