"use client"

import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Link2, Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useI18n } from "@/lib/i18n/client"
import { fmt as fill } from "@/lib/i18n/core"
import type { AliasState } from "@/lib/sms"
import { ConsoleShell, PageHead } from "../console-shell"
import { useConfirm } from "../confirm-dialog"
import { aliasErrorText, AliasStateBadge } from "./sms-shared"

/** One alias as OpenAPI holds it (operator-sms-alias `openapi_list`). */
interface OpenApiAlias {
  id: string | null
  sender: string | null
  state: AliasState | null
  rejectReason: string | null
  patchRequests: Array<{ reason: string; requestedAt: string | null }>
  countryCode: string | null
  type: string | null
  createdAt: string | null
  updatedAt: string | null
  registrationData: Record<string, string>
  link: { alias_id: string; business_id: string; business_name: string | null } | null
}

type PatchField = "pec" | "companyWebsite" | "industry" | "senderCompanyRelationship"
const PATCH_FIELDS: PatchField[] = ["pec", "companyWebsite", "industry", "senderCompanyRelationship"]
const MAX_LEN: Record<PatchField, number> = { pec: 65, companyWebsite: 200, industry: 50, senderCompanyRelationship: 60 }

/** A restaurant to link an alias to (from GET /api/sms). */
interface Restaurant {
  business_id: string
  business_name: string
  alias: { state: AliasState } | null
}

const isLive = (s: AliasState | null | undefined) => !!s && s !== "DELETED" && s !== "REJECTED"
const canChange = (s: AliasState | null) => s === "PATCH_REQUIRED"
const canDelete = (s: AliasState | null) => s === "APPROVED" || s === "PATCH_REQUIRED"

function ChangeForm({ alias, busy, onSubmit }: { alias: OpenApiAlias; busy: boolean; onSubmit: (patch: Record<PatchField, string>) => void }) {
  const { t } = useI18n()
  const f = t.sms.form
  const labels: Record<PatchField, string> = { pec: f.pec, companyWebsite: f.website, industry: f.industry, senderCompanyRelationship: f.relationship }
  const [values, setValues] = useState<Record<PatchField, string>>(() => ({
    pec: alias.registrationData.pec ?? "",
    companyWebsite: alias.registrationData.companyWebsite ?? "",
    industry: alias.registrationData.industry ?? "",
    senderCompanyRelationship: alias.registrationData.senderCompanyRelationship ?? "",
  }))
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(values)
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {PATCH_FIELDS.map((k) => (
          <div key={k} className="space-y-1">
            <Label htmlFor={`oa-${alias.id}-${k}`}>{labels[k]}</Label>
            <Input
              id={`oa-${alias.id}-${k}`}
              value={values[k]}
              maxLength={MAX_LEN[k]}
              type={k === "pec" ? "email" : k === "companyWebsite" ? "url" : "text"}
              required
              onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
            />
          </div>
        ))}
      </div>
      <Button type="submit" disabled={busy}>
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {t.sms.openapi.sendChange}
      </Button>
    </form>
  )
}

// Every sender alias on BirraOra's OpenAPI account, read live from OpenAPI,
// with the restaurant each one belongs to. Change and delete go to OpenAPI.
export function OpenApiAliases({ adminEmail = null }: { adminEmail?: string | null }) {
  const { t, fmt, locale } = useI18n()
  const { confirm, dialog } = useConfirm()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const [aliases, setAliases] = useState<OpenApiAlias[]>([])
  const [environment, setEnvironment] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [linking, setLinking] = useState<string | null>(null)
  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null)
  const [pick, setPick] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const o = t.sms.openapi

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch("/api/sms/openapi", { cache: "no-store" })
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      setAliases(j.senders ?? [])
      setEnvironment(j.environment ?? null)
    } else if (j.error === "invalid_payload" || res.status === 404) {
      // The deployed Edge Function predates the account-wide actions (or isn't deployed).
      setError(tRef.current.sms.openapi.backendOutdated)
    } else setError(aliasErrorText(tRef.current, fill, j))
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const send = async (action: "patch" | "delete", alias: OpenApiAlias, patch?: Record<string, string>) => {
    if (!alias.id) return
    setBusy(`${action}:${alias.id}`)
    setError("")
    setNotice("")
    const res = await fetch("/api/sms/openapi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, openapi_id: alias.id, patch }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) setError(aliasErrorText(t, fmt, j))
    else {
      setNotice(action === "delete" ? o.doneDeleted : o.donePatched)
      setEditing(null)
    }
    await load()
    setBusy(null)
  }

  const startLink = async (key: string) => {
    setOpen(key)
    setEditing(null)
    setPick("")
    setLinking(linking === key ? null : key)
    if (restaurants) return
    const res = await fetch("/api/sms", { cache: "no-store" })
    const j = await res.json().catch(() => ({}))
    if (res.ok) setRestaurants(j.businesses ?? [])
    else setError(j.error || t.sms.loadFailed)
  }

  // Confirms in plain words what linking does, then records it (nothing goes to OpenAPI).
  const askLink = async (alias: OpenApiAlias) => {
    const r = restaurants?.find((x) => x.business_id === pick)
    if (!alias.id || !r) return
    const vars = { sender: alias.sender ?? alias.id, restaurant: r.business_name }
    const effect = alias.state === "APPROVED" ? o.linkApprovedNow : isLive(alias.state) ? o.linkNotYet : o.linkHistory
    const ok = await confirm({
      title: fmt(o.linkConfirmTitle, vars),
      description: (
        <div className="space-y-2 text-sm">
          <p className={alias.state === "APPROVED" ? "font-medium" : undefined}>{fmt(effect, vars)}</p>
          <p className="text-muted-foreground">{o.linkNothingAtOpenapi}</p>
        </div>
      ),
      confirmLabel: o.linkSubmit,
    })
    if (!ok) return
    setBusy(`link:${alias.id}`)
    setError("")
    setNotice("")
    const res = await fetch("/api/sms/openapi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "link", openapi_id: alias.id, business_id: r.business_id }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) setError(aliasErrorText(t, fmt, j))
    else {
      setNotice(fmt(o.linkDone, { restaurant: r.business_name }))
      setLinking(null)
      setRestaurants(null)
    }
    await load()
    setBusy(null)
  }

  const askDelete = async (alias: OpenApiAlias) => {
    const restaurant = alias.link?.business_name
    const ok = await confirm({
      title: fmt(o.deleteTitle, { sender: alias.sender ?? alias.id ?? "" }),
      description: (
        <div className="space-y-3 text-sm">
          {alias.state === "APPROVED" && restaurant && <p className="font-medium text-destructive">{fmt(o.deleteStops, { restaurant })}</p>}
          <div>
            <p className="font-medium">{o.deleted}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>{o.deleteAtOpenapi}</li>
            </ul>
          </div>
          <div>
            <p className="font-medium">{o.kept}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>{alias.link ? o.deleteKeptRecord : o.deleteKeptNone}</li>
              <li>{o.deleteKeptLog}</li>
            </ul>
          </div>
        </div>
      ),
      confirmLabel: o.delete,
      destructive: true,
    })
    if (ok) void send("delete", alias)
  }

  const date = (iso: string | null) => {
    if (!iso) return "—"
    const d = new Date(iso.replace(" ", "T").replace(" ", ""))
    return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(d)
  }

  return (
    <ConsoleShell adminEmail={adminEmail}>
      <PageHead
        title={o.title}
        description={
          <>
            {o.description}
            {environment && <span className="ml-1 font-medium text-foreground">{fmt(o.environment, { env: environment })}</span>}
          </>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden />
              {o.reload}
            </Button>
            <Button asChild variant="outline">
              <Link href="/sms">{t.sms.back}</Link>
            </Button>
          </div>
        }
      />

      <div className="space-y-4">
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{loading ? o.loading : o.count(aliases.length)}</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && aliases.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
                {o.loading}
              </div>
            ) : aliases.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">{o.empty}</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{o.cols.sender}</TableHead>
                      <TableHead>{o.cols.country}</TableHead>
                      <TableHead>{o.cols.state}</TableHead>
                      <TableHead>{o.cols.restaurant}</TableHead>
                      <TableHead>{o.cols.updated}</TableHead>
                      <TableHead className="text-right">{o.cols.actions}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aliases.map((a, i) => {
                      const key = a.id ?? `row-${i}`
                      const expanded = open === key
                      return (
                        <Fragment key={key}>
                          <TableRow>
                            <TableCell className="font-mono text-sm">{a.sender ?? "—"}</TableCell>
                            <TableCell>{a.countryCode ?? "—"}</TableCell>
                            <TableCell>
                              <AliasStateBadge state={a.state} t={t} />
                            </TableCell>
                            <TableCell>
                              {a.link ? (
                                <Link href={`/sms/${a.link.business_id}`} className="text-primary underline-offset-2 hover:underline">
                                  {a.link.business_name ?? a.link.business_id}
                                </Link>
                              ) : (
                                <span className="text-xs text-amber-700">{o.notLinked}</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm">{date(a.updatedAt)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-wrap justify-end gap-1">
                                <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : key)}>
                                  {expanded ? o.hide : o.details}
                                </Button>
                                {!a.link && a.id && (
                                  <Button variant="default" size="sm" disabled={!!busy} onClick={() => void startLink(key)}>
                                    <Link2 className="h-4 w-4" aria-hidden />
                                    {o.linkAction}
                                  </Button>
                                )}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={!canChange(a.state) || !!busy}
                                  title={canChange(a.state) ? undefined : o.changeOnlyPatch}
                                  onClick={() => {
                                    setOpen(key)
                                    setLinking(null)
                                    setEditing(editing === key ? null : key)
                                  }}
                                >
                                  <Pencil className="h-4 w-4" aria-hidden />
                                  {o.change}
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  disabled={!canDelete(a.state) || !!busy}
                                  title={canDelete(a.state) ? undefined : o.deleteOnly}
                                  onClick={() => void askDelete(a)}
                                >
                                  {busy === `delete:${a.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
                                  {o.delete}
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {expanded && (
                            <TableRow>
                              <TableCell colSpan={6} className="bg-muted/30">
                                <div className="space-y-3 py-2 text-sm">
                                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                                    {a.id && <span className="font-mono">{fmt(o.openapiId, { id: a.id })}</span>}
                                    {a.type && <span>{fmt(o.type, { type: a.type })}</span>}
                                    <span>{fmt(o.created, { date: date(a.createdAt) })}</span>
                                  </div>
                                  {a.rejectReason && <p className="text-destructive">{fmt(t.sms.alias.rejected, { reason: a.rejectReason })}</p>}
                                  {a.patchRequests.length > 0 && (
                                    <div>
                                      <p className="font-medium">{t.sms.alias.corrections}</p>
                                      <ul className="list-disc pl-5">
                                        {a.patchRequests.map((p, n) => (
                                          <li key={n}>
                                            {p.reason}
                                            {p.requestedAt && <span className="text-muted-foreground"> · {p.requestedAt}</span>}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  <div>
                                    <p className="font-medium">{o.registration}</p>
                                    {Object.keys(a.registrationData).length === 0 ? (
                                      <p className="text-muted-foreground">{o.noRegistration}</p>
                                    ) : (
                                      <dl className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                                        {Object.entries(a.registrationData).map(([k, v]) => (
                                          <div key={k} className="flex gap-2">
                                            <dt className="text-muted-foreground">{k}</dt>
                                            <dd className="break-all">{v}</dd>
                                          </div>
                                        ))}
                                      </dl>
                                    )}
                                  </div>
                                  {!canChange(a.state) && <p className="text-xs text-muted-foreground">{o.changeOnlyPatch}</p>}
                                  {!canDelete(a.state) && <p className="text-xs text-muted-foreground">{o.deleteOnly}</p>}
                                  {linking === key && !a.link && (
                                    <div className="space-y-2 border-t pt-3">
                                      <p className="font-medium">{fmt(o.linkTitle, { sender: a.sender ?? a.id ?? "" })}</p>
                                      {!restaurants ? (
                                        <p className="flex items-center gap-2 text-muted-foreground">
                                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                          {o.linkLoading}
                                        </p>
                                      ) : (
                                        <div className="flex flex-wrap items-end gap-2">
                                          <div className="min-w-64 space-y-1">
                                            <Label htmlFor={`oa-link-${key}`}>{o.linkPick}</Label>
                                            <Select value={pick} onValueChange={setPick}>
                                              <SelectTrigger id={`oa-link-${key}`} className="w-full">
                                                <SelectValue placeholder={o.linkPlaceholder} />
                                              </SelectTrigger>
                                              <SelectContent>
                                                {restaurants.map((r) => {
                                                  // A live alias can't join a restaurant that already has one.
                                                  const blocked = isLive(a.state) && isLive(r.alias?.state)
                                                  return (
                                                    <SelectItem key={r.business_id} value={r.business_id} disabled={blocked}>
                                                      {blocked ? fmt(o.linkHasAlias, { name: r.business_name }) : r.business_name}
                                                    </SelectItem>
                                                  )
                                                })}
                                              </SelectContent>
                                            </Select>
                                          </div>
                                          <Button disabled={!pick || !!busy} onClick={() => void askLink(a)}>
                                            {busy === `link:${a.id}` && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                                            {o.linkSubmit}
                                          </Button>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {editing === key && canChange(a.state) && (
                                    <div className="space-y-2 border-t pt-3">
                                      <p className="font-medium">{o.changeTitle}</p>
                                      <ChangeForm alias={a} busy={busy === `patch:${a.id}`} onSubmit={(patch) => void send("patch", a, patch)} />
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {dialog}
    </ConsoleShell>
  )
}
