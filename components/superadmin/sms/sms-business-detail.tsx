"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Loader2, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useI18n } from "@/lib/i18n/client"
import type { Messages } from "@/lib/i18n/messages"
import {
  currentAlias,
  formatEuro,
  removalPlan,
  romeMonthStartDay,
  romeToday,
  type SmsAlias,
  type SmsMessageRow,
  type SmsUsage,
} from "@/lib/sms"
import { ConsoleShell, PageHead } from "../console-shell"
import { useConfirm } from "../confirm-dialog"
import { aliasErrorText, AliasStateBadge, formatDateTime } from "./sms-shared"

interface Detail {
  business: { business_id: string; business_name: string; slug: string; whatsapp_number: string | null; phone: string | null }
  aliases: SmsAlias[]
  usage: { range: SmsUsage; month: SmsUsage; total: SmsUsage }
  messages: SmsMessageRow[]
}

type RegField = "sender" | "pec" | "companyWebsite" | "industry" | "senderCompanyRelationship"

function fieldText(t: Messages, f: RegField): { label: string; hint: string } {
  const s = t.sms.form
  switch (f) {
    case "sender":
      return { label: s.sender, hint: s.senderHint }
    case "pec":
      return { label: s.pec, hint: s.pecHint }
    case "companyWebsite":
      return { label: s.website, hint: s.websiteHint }
    case "industry":
      return { label: s.industry, hint: s.industryHint }
    case "senderCompanyRelationship":
      return { label: s.relationship, hint: s.relationshipHint }
  }
}

const MAX_LEN: Record<RegField, number> = { sender: 11, pec: 65, companyWebsite: 200, industry: 50, senderCompanyRelationship: 60 }

function AliasForm({
  mode,
  initial,
  busy,
  onSubmit,
}: {
  mode: "create" | "patch"
  initial: Partial<Record<RegField, string>>
  busy: boolean
  onSubmit: (values: Record<RegField, string>) => void
}) {
  const { t } = useI18n()
  const [values, setValues] = useState<Record<RegField, string>>({
    sender: initial.sender ?? "",
    pec: initial.pec ?? "",
    companyWebsite: initial.companyWebsite ?? "",
    industry: initial.industry ?? t.sms.form.industryDefault,
    senderCompanyRelationship: initial.senderCompanyRelationship ?? t.sms.form.relationshipDefault,
  })
  const fields: RegField[] =
    mode === "create" ? ["sender", "pec", "companyWebsite", "industry", "senderCompanyRelationship"] : ["pec", "companyWebsite", "industry", "senderCompanyRelationship"]
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(values)
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const text = fieldText(t, f)
          return (
            <div key={f} className="space-y-1">
              <Label htmlFor={`alias-${f}`}>{text.label}</Label>
              <Input
                id={`alias-${f}`}
                value={values[f]}
                maxLength={MAX_LEN[f]}
                type={f === "pec" ? "email" : f === "companyWebsite" ? "url" : "text"}
                required
                aria-describedby={`alias-${f}-hint`}
                onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
              />
              <p id={`alias-${f}-hint`} className="text-xs text-muted-foreground">
                {text.hint}
              </p>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">{t.sms.form.fixed}</p>
      <Button type="submit" disabled={busy}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {mode === "create" ? t.sms.form.register : t.sms.form.sendCorrection}
      </Button>
    </form>
  )
}

function UsageTile({ title, u }: { title: string; u: SmsUsage }) {
  const { t, fmt, locale } = useI18n()
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{fmt(t.sms.usage.messages, { n: u.messages })}</div>
      <div className="text-sm tabular-nums text-muted-foreground">
        {fmt(t.sms.usage.parts, { parts: u.sms_parts, cost: formatEuro(u.total_cost, locale) })}
      </div>
      <div className="text-xs tabular-nums text-muted-foreground">
        {fmt(t.sms.usage.outcome, { delivered: u.delivered, failed: u.failed })}
      </div>
    </div>
  )
}

export function SmsBusinessDetail({ businessId, adminEmail = null }: { businessId: string; adminEmail?: string | null }) {
  const { t, fmt, locale } = useI18n()
  const { confirm, dialog } = useConfirm()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [from, setFrom] = useState(() => romeMonthStartDay())
  const [to, setTo] = useState(() => romeToday())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams({ business_id: businessId })
    if (from) qs.set("from", from)
    if (to) qs.set("to", to)
    const res = await fetch(`/api/sms/business?${qs}`, { cache: "no-store" })
    const j = await res.json().catch(() => ({}))
    if (res.ok) setDetail(j as Detail)
    else setError(j.error || tRef.current.sms.loadFailed)
    setLoading(false)
  }, [businessId, from, to])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (action: "create" | "refresh" | "patch" | "remove", extra: Record<string, unknown> = {}) => {
    setBusy(action)
    setError("")
    setNotice("")
    const res = await fetch("/api/sms/alias", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, business_id: businessId, ...extra }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) setError(aliasErrorText(t, fmt, j))
    else {
      const state = (j.alias as SmsAlias | undefined)?.state
      const d = t.sms.done
      setNotice(
        action === "create"
          ? state === "APPROVED"
            ? d.createdApproved
            : d.createdPending
          : action === "patch"
            ? d.patched
            : action === "remove"
              ? j.openapi === "deleted"
                ? d.removedDeleted
                : j.openapi === "kept"
                  ? fmt(d.removedKept, { reason: d.keptReasons[j.reason as string] ?? j.reason })
                  : d.removedNone
              : d.refreshed,
      )
    }
    await load()
    setBusy(null)
  }

  // Says, before anything happens, what deleting this alias removes and what stays.
  const askRemove = async (target: SmsAlias) => {
    const plan = removalPlan(target.state)
    const deleted = [a.removeRecord, ...(plan === "deleted" ? [a.removeAtOpenapi] : [])]
    const kept = [
      ...(plan === "kept" ? [target.state === "DELETING" ? a.removeKeptDeleting : a.removeKeptReview] : []),
      ...(plan === "none" ? [a.removeNoneAtOpenapi] : []),
      a.removeKeptLog,
    ]
    const ok = await confirm({
      title: fmt(a.removeTitle, { sender: target.sender }),
      description: (
        <div className="space-y-3 text-sm">
          {target.state === "APPROVED" && <p className="font-medium text-destructive">{a.removeStopsCodes}</p>}
          <div>
            <p className="font-medium">{a.removeDeleted}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {deleted.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium">{a.removeKept}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {kept.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">{a.removeOtherEnv}</p>
        </div>
      ),
      confirmLabel: a.remove,
      destructive: true,
    })
    if (ok) void act("remove", { alias_id: target.id })
  }

  const alias = detail ? currentAlias(detail.aliases) : null
  const live = alias && alias.state !== "DELETED" && alias.state !== "REJECTED" ? alias : null
  const history = detail?.aliases.filter((a) => a.id !== alias?.id) ?? []
  const a = t.sms.alias
  const m = t.sms.messages

  const whatsapp = detail
    ? detail.business.whatsapp_number ??
      (detail.business.phone ? fmt(t.sms.whatsappPhone, { phone: detail.business.phone }) : t.sms.whatsappNone)
    : ""

  return (
    <ConsoleShell adminEmail={adminEmail}>
      <PageHead
        title={detail?.business.business_name ?? t.sms.title}
        description={detail ? `${detail.business.slug} · ${fmt(t.sms.whatsappFor, { value: whatsapp })}` : undefined}
        action={
          <Button asChild variant="outline">
            <Link href="/sms">{t.sms.back}</Link>
          </Button>
        }
      />

      <div className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        {loading && !detail ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
            {t.sms.loading}
          </div>
        ) : detail ? (
          <>
            {/* Alias */}
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {a.title} <AliasStateBadge state={alias?.state} t={t} />
                </CardTitle>
                <CardDescription>{live?.state === "APPROVED" ? a.approved : a.blocked}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {alias && (
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">{a.sender}</dt>
                      <dd className="font-mono">{alias.sender}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{a.environment}</dt>
                      <dd>{alias.environment}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{a.lastChecked}</dt>
                      <dd>{formatDateTime(alias.last_synced_at, locale)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{a.pec}</dt>
                      <dd className="break-all">{alias.registration_data.pec ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{a.website}</dt>
                      <dd className="break-all">{alias.registration_data.companyWebsite ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{a.openapiId}</dt>
                      <dd className="break-all font-mono text-xs">{alias.openapi_sender_id}</dd>
                    </div>
                  </dl>
                )}

                {alias?.state === "REJECTED" && (
                  <Alert variant="destructive">
                    <AlertDescription>{alias.reject_reason ? fmt(a.rejected, { reason: alias.reject_reason }) : a.rejectedNoReason}</AlertDescription>
                  </Alert>
                )}

                {alias && alias.patch_requests.length > 0 && (
                  <div className="rounded-lg border border-amber-600/40 p-3 text-sm">
                    <div className="mb-1 font-medium">{a.corrections}</div>
                    <ul className="list-disc space-y-1 pl-5">
                      {alias.patch_requests.map((p, i) => (
                        <li key={i}>
                          {p.reason}
                          {p.requestedAt && <span className="text-muted-foreground"> · {p.requestedAt}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {alias && (
                  <div className="flex flex-wrap gap-2">
                    {live && (
                      <Button variant="outline" onClick={() => void act("refresh", { alias_id: live.id })} disabled={!!busy}>
                        {busy === "refresh" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
                        {a.refresh}
                      </Button>
                    )}
                    {/* Any state: the dialog says what is deleted and what is kept. */}
                    <Button variant="destructive" disabled={!!busy} onClick={() => void askRemove(alias)}>
                      {busy === "remove" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                      {a.remove}
                    </Button>
                  </div>
                )}

                {live?.state === "PATCH_REQUIRED" && (
                  <div className="space-y-2 border-t pt-4">
                    <h2 className="text-sm font-semibold">{a.correctTitle}</h2>
                    <AliasForm
                      mode="patch"
                      initial={live.registration_data}
                      busy={busy === "patch"}
                      onSubmit={(v) => {
                        // The sender name can't change after registration.
                        const { pec, companyWebsite, industry, senderCompanyRelationship } = v
                        void act("patch", { alias_id: live.id, patch: { pec, companyWebsite, industry, senderCompanyRelationship } })
                      }}
                    />
                  </div>
                )}

                {!live && (
                  <div id="create" className="space-y-2 border-t pt-4">
                    <h2 className="text-sm font-semibold">{a.registerTitle}</h2>
                    <AliasForm
                      mode="create"
                      initial={{ ...(alias?.registration_data ?? {}), sender: alias?.state === "REJECTED" ? "" : alias?.sender }}
                      busy={busy === "create"}
                      onSubmit={(v) => void act("create", { registration: v })}
                    />
                  </div>
                )}

                {history.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">{a.earlier(history.length)}</summary>
                    <ul className="mt-2 space-y-1">
                      {history.map((h) => (
                        <li key={h.id} className="flex flex-wrap items-center gap-2">
                          <span className="font-mono">{h.sender}</span>
                          <AliasStateBadge state={h.state} t={t} />
                          <span className="text-muted-foreground">
                            {h.environment} · {formatDateTime(h.updated_at, locale)}
                            {h.reject_reason ? ` · ${h.reject_reason}` : ""}
                          </span>
                          <Button variant="ghost" size="sm" className="text-destructive" disabled={!!busy} onClick={() => void askRemove(h)}>
                            <Trash2 className="h-4 w-4" aria-hidden />
                            {a.remove}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </CardContent>
            </Card>

            {/* Usage */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t.sms.usage.title}</CardTitle>
                <CardDescription>{t.sms.usage.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="sms-from">{t.sms.usage.from}</Label>
                    <Input id="sms-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sms-to">{t.sms.usage.to}</Label>
                    <Input id="sms-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                  </div>
                  {loading && <Loader2 className="mb-2 h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <UsageTile
                    title={fmt(t.sms.usage.range, { from: from || t.sms.usage.start, to: to || t.sms.usage.today })}
                    u={detail.usage.range}
                  />
                  <UsageTile title={t.sms.usage.month} u={detail.usage.month} />
                  <UsageTile title={t.sms.usage.total} u={detail.usage.total} />
                </div>
              </CardContent>
            </Card>

            {/* Messages */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{m.title}</CardTitle>
                <CardDescription>{m.description}</CardDescription>
              </CardHeader>
              <CardContent>
                {detail.messages.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">{m.empty}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{m.cols.requested}</TableHead>
                          <TableHead>{m.cols.purpose}</TableHead>
                          <TableHead>{m.cols.to}</TableHead>
                          <TableHead>{m.cols.sender}</TableHead>
                          <TableHead>{m.cols.status}</TableHead>
                          <TableHead className="text-right">{m.cols.parts}</TableHead>
                          <TableHead className="text-right">{m.cols.cost}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.messages.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="whitespace-nowrap">{formatDateTime(row.requested_at, locale)}</TableCell>
                            <TableCell>
                              {row.purpose === "sign_in" ? m.login : row.purpose === "phone_change" ? m.checkout : row.purpose}
                              {row.channel === "staff" && <span className="text-xs text-muted-foreground">{m.staff}</span>}
                            </TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-xs">{row.recipient ?? "—"}</TableCell>
                            <TableCell className="font-mono text-xs">{row.sender ?? "—"}</TableCell>
                            <TableCell>
                              <div>{row.delivery_state ?? (row.status === "SUCCESS" ? m.sent : row.status === "FAILED" ? m.failed : m.pending)}</div>
                              {row.error_code && <div className="text-xs text-destructive">{row.error_code}</div>}
                              {row.delivered_at && <div className="text-xs text-muted-foreground">{formatDateTime(row.delivered_at, locale)}</div>}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{row.segment_count ?? "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{row.total_price === null ? "—" : formatEuro(row.total_price, locale)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : null}
      </div>
      {dialog}
    </ConsoleShell>
  )
}
