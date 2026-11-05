"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useI18n } from "@/lib/i18n/client"
import { formatEuro, type SmsAlias, type SmsUsage } from "@/lib/sms"
import { ConsoleShell, PageHead } from "../console-shell"
import { AliasStateBadge } from "./sms-shared"

interface Row {
  business_id: string
  business_name: string
  slug: string
  whatsapp_set: boolean
  alias: SmsAlias | null
  usage_month: SmsUsage
  usage_total: SmsUsage
}

const needsAlias = (a: SmsAlias | null) => !a || a.state === "DELETED" || a.state === "REJECTED"

// Every restaurant's SMS sender alias and SMS usage. Without an APPROVED
// alias a restaurant's phone sign-in and checkout verification are blocked.
export function SmsOverview({ adminEmail = null }: { adminEmail?: string | null }) {
  const { t, fmt, locale } = useI18n()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    const res = await fetch("/api/sms", { cache: "no-store" })
    const j = await res.json().catch(() => ({}))
    if (res.ok) setRows(j.businesses ?? [])
    else setError(j.error || tRef.current.sms.loadFailed)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const blocked = rows.filter((r) => r.alias?.state !== "APPROVED").length
  const usage = (u: SmsUsage) => (
    <div className="text-right tabular-nums">
      <div>{fmt(t.sms.usageLine, { messages: u.messages, parts: u.sms_parts })}</div>
      <div className="text-xs text-muted-foreground">{formatEuro(u.total_cost, locale)}</div>
    </div>
  )

  return (
    <ConsoleShell adminEmail={adminEmail}>
      <PageHead
        title={t.sms.title}
        description={t.sms.description}
        action={
          <Button asChild variant="outline">
            <Link href="/sms/openapi">{t.sms.openapi.link}</Link>
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? t.sms.loading : `${t.sms.count(rows.length)}${blocked ? fmt(t.sms.withoutApproved, { n: blocked }) : ""}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
              {t.sms.loading}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">{t.sms.empty}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.sms.cols.restaurant}</TableHead>
                    <TableHead>{t.sms.cols.sender}</TableHead>
                    <TableHead>{t.sms.cols.state}</TableHead>
                    <TableHead className="text-right">{t.sms.cols.month}</TableHead>
                    <TableHead className="text-right">{t.sms.cols.total}</TableHead>
                    <TableHead className="text-right">{t.sms.cols.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.business_id}>
                      <TableCell>
                        <div className="font-medium">{r.business_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.slug}
                          {!r.whatsapp_set && <span className="ml-2 text-amber-700">{t.sms.noWhatsapp}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {r.alias ? r.alias.sender : <span className="text-muted-foreground">—</span>}
                        {r.alias && <div className="font-sans text-xs text-muted-foreground">{r.alias.environment}</div>}
                      </TableCell>
                      <TableCell>
                        <AliasStateBadge state={r.alias?.state} t={t} />
                      </TableCell>
                      <TableCell>{usage(r.usage_month)}</TableCell>
                      <TableCell>{usage(r.usage_total)}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant={needsAlias(r.alias) ? "default" : "outline"}>
                          <Link href={`/sms/${r.business_id}`}>{needsAlias(r.alias) ? t.sms.createAlias : t.sms.open}</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </ConsoleShell>
  )
}
