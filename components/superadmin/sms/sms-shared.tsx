"use client"

import { Badge } from "@/components/ui/badge"
import type { Messages } from "@/lib/i18n/messages"
import type { AliasState } from "@/lib/sms"

export function AliasStateBadge({ state, t }: { state: AliasState | null | undefined; t: Messages }) {
  if (!state) return <Badge variant="destructive">{t.sms.states.none}</Badge>
  const label = t.sms.states[state]
  if (state === "APPROVED") return <Badge variant="secondary">{label}</Badge>
  if (state === "REJECTED") return <Badge variant="destructive">{label}</Badge>
  if (state === "PATCH_REQUIRED" || state === "PENDING") {
    return (
      <Badge variant="outline" className="border-amber-600/50 text-amber-700">
        {label}
      </Badge>
    )
  }
  return <Badge variant="outline">{label}</Badge>
}

export function formatDateTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return new Intl.DateTimeFormat(locale, { timeZone: "Europe/Rome", dateStyle: "short", timeStyle: "short" }).format(d)
}

/** Readable text for an error answer of /api/sms/alias. */
export function aliasErrorText(
  t: Messages,
  fmt: (s: string, v: Record<string, string | number>) => string,
  j: { error?: string; code?: string | null; message?: string | null; fields?: string[] },
): string {
  const e = t.sms.errors
  switch (j.error) {
    case "invalid_registration":
      return fmt(e.invalid_registration, { fields: (j.fields ?? []).join("; ") })
    case "alias_exists":
    case "not_patch_required":
    case "not_deletable":
    case "other_environment":
    case "business_not_found":
    case "alias_not_found":
    case "already_linked":
    case "not_italian_alias":
      return e[j.error]
    case "openapi_error": {
      const detail = `${j.code ? ` (${j.code})` : ""}${j.message ? `: ${j.message}` : ""}`
      return fmt(e.openapi_error, { detail })
    }
    default:
      return fmt(e.failed, { detail: j.error ? ` (${j.error})` : "" })
  }
}
