"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription } from "@/components/ui/alert"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Loader2, MapPinned, Pencil, Plus, Search } from "lucide-react"
import { domainDisplayHost } from "@/lib/domains"
import { getReadiness } from "@/lib/readiness"
import { ConsoleShell, PageHead } from "./console-shell"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"
import { SetupSummary } from "./setup-status"
import { CreateBusinessDialog } from "./create-business-dialog"
import { PayoutAccountCell, type PayoutAccountSummary } from "./payout-account-cell"

export interface BusinessRow {
  business_id: string
  business_name: string
  name_abbreviation: string
  tax_id: string | null
  address: string | null
  phone: string | null
  email: string | null
  logo_url: string | null
  created_at: string
  /** Every host this business can be reached on. */
  domains: { domain: string; is_primary: boolean; is_active: boolean; label: string | null }[]
  /** The primary domain, kept as a convenience for single-value renders. */
  domain: string | null
  config: {
    timezone: string | null
    currency: string | null
    minimum_charge: number | null
    max_concurrent_appointments: number | null
    open_days_and_hours: unknown | null
    /** {"card": bool, "cash": bool} */
    payment_methods?: { card?: boolean; cash?: boolean } | null
  } | null
  /** Immutable tenant key (storage folders). */
  slug: string
  sms_sender_name: string | null
  email_from_name: string | null
  /** Where the new-order email goes (set_order_settings). */
  order_notification_email: string | null
  /** From user_roles. */
  owner_count: number
  staff_count: number
  readiness: { has_owner: boolean; sms_sender_set: boolean }
  /** Delivery zones: live version, and whether the draft has unpublished changes. */
  zones: { published_version: number | null; has_draft_changes: boolean }
  /** Stripe connected account (Part A), null until created. */
  payout_account: PayoutAccountSummary | null
}

export function SuperAdminDashboard({
  adminEmail,
  rootDomain,
}: {
  adminEmail: string | null
  rootDomain: string
}) {
  const { t, fmt } = useI18n()
  // Latest strings for the loader, so switching language doesn't refetch.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const [businesses, setBusinesses] = useState<BusinessRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<"all" | "setup">("all")

  const hasLoaded = useRef(false)
  const load = useCallback(async () => {
    // Only the first load shows the spinner; a refresh after creating a
    // restaurant keeps the table in place.
    if (!hasLoaded.current) setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/businesses")
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(apiError(tRef.current, j.error, res.status))
      }
      const j = await res.json()
      const rows: BusinessRow[] = j.businesses ?? []
      hasLoaded.current = true
      setBusinesses(rows)
    } catch (e) {
      // fetch() itself throws a TypeError when the server can't be reached.
      setError(e instanceof Error && !(e instanceof TypeError) ? e.message : tRef.current.common.network)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const withReadiness = useMemo(
    () => businesses.map((b) => ({ row: b, readiness: getReadiness(b) })),
    [businesses],
  )
  const needsSetup = withReadiness.filter((x) => !x.readiness.ready).length

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return withReadiness.filter(({ row, readiness }) => {
      if (filter === "setup" && readiness.ready) return false
      if (!q) return true
      return (
        row.business_name.toLowerCase().includes(q) ||
        row.slug.includes(q) ||
        row.name_abbreviation.toLowerCase().includes(q) ||
        row.domains?.some((d) => d.domain.includes(q))
      )
    })
  }, [withReadiness, query, filter])

  return (
    <ConsoleShell adminEmail={adminEmail}>
      <PageHead
        title={t.dashboard.title}
        description={t.dashboard.description}
        action={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t.dashboard.newRestaurant}
          </Button>
        }
      />


      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{fmt(t.dashboard.loadFailed, { error })}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t.common.tryAgain}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
          <div role="group" aria-label={t.dashboard.filterLabel} className="inline-flex rounded-md border bg-muted/50 p-0.5">
            <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
              {t.dashboard.all} <span className="tabular-nums text-muted-foreground">{loading ? "" : businesses.length}</span>
            </FilterButton>
            <FilterButton active={filter === "setup"} onClick={() => setFilter("setup")}>
              {t.dashboard.needsSetup} <span className="tabular-nums text-muted-foreground">{loading ? "" : needsSetup}</span>
            </FilterButton>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              className="pl-9"
              placeholder={t.dashboard.searchPlaceholder}
              aria-label={t.dashboard.searchLabel}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground" role="status">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            {t.dashboard.loading}
          </div>
        ) : businesses.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="font-medium">{t.dashboard.emptyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t.dashboard.emptyBody}</p>
            <Button className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t.dashboard.newRestaurant}
            </Button>
          </div>
        ) : shown.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            {filter === "setup" && !query ? t.dashboard.allReady : t.dashboard.noMatch}{" "}
            <button
              type="button"
              className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => {
                setQuery("")
                setFilter("all")
              }}
            >
              {t.common.showAll}
            </button>
          </div>
        ) : (
          <>
            {/* Wide screens: one row per restaurant. */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">{t.dashboard.colRestaurant}</TableHead>
                    <TableHead>{t.dashboard.colSetup}</TableHead>
                    <TableHead>{t.dashboard.colDomains}</TableHead>
                    <TableHead>{t.dashboard.colPayout}</TableHead>
                    <TableHead className="pr-6 text-right">
                      <span className="sr-only">{t.dashboard.colActions}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map(({ row: b, readiness }) => (
                    <TableRow key={b.business_id} className="align-top">
                      <TableCell className="min-w-[12rem] py-3 pl-6 whitespace-normal">
                        <RestaurantName row={b} />
                      </TableCell>
                      <TableCell className="min-w-[13rem] py-3 whitespace-normal">
                        <SetupSummary readiness={readiness} />
                      </TableCell>
                      <TableCell className="max-w-[15rem] py-3 whitespace-normal">
                        <DomainList domains={b.domains} rootDomain={rootDomain} />
                      </TableCell>
                      <TableCell className="py-3">
                        <PayoutAccountCell businessId={b.business_id} businessName={b.business_name} account={b.payout_account ?? null} onCreated={load} />
                      </TableCell>
                      <TableCell className="py-3 pr-6 text-right">
                        <RowActions row={b} ready={readiness.ready} className="justify-end" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Phones: the same facts stacked, actions last, nothing to scroll sideways. */}
            <ul className="divide-y md:hidden">
              {shown.map(({ row: b, readiness }) => (
                <li key={b.business_id} className="space-y-3 px-4 py-4">
                  <RestaurantName row={b} />
                  <SetupSummary readiness={readiness} />
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">{t.dashboard.colDomains}</dt>
                    <dd className="min-w-0">
                      <DomainList domains={b.domains} rootDomain={rootDomain} />
                    </dd>
                    <dt className="text-muted-foreground">{t.dashboard.payoutShort}</dt>
                    <dd className="min-w-0">
                      <PayoutAccountCell businessId={b.business_id} businessName={b.business_name} account={b.payout_account ?? null} onCreated={load} />
                    </dd>
                  </dl>
                  <RowActions row={b} ready={readiness.ready} className="-ml-3" />
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <CreateBusinessDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rootDomain={rootDomain}
        onCreated={() => {
          void load()
        }}
        onContinue={(id) => router.push(`/businesses/${id}`)}
      />
    </ConsoleShell>
  )
}

function RestaurantName({ row }: { row: BusinessRow }) {
  const { t, fmt, locale } = useI18n()
  return (
    <div>
      <Link
        href={`/businesses/${row.business_id}`}
        className="rounded-sm font-medium underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {row.business_name}
      </Link>
      <div className="mt-0.5 font-mono text-xs text-muted-foreground">{row.slug}</div>
      <div className="text-xs text-muted-foreground">
        {fmt(t.dashboard.created, { currency: row.config?.currency ?? "EUR", date: formatDate(row.created_at, locale) })}
      </div>
    </div>
  )
}

function DomainList({ domains, rootDomain }: { domains: BusinessRow["domains"]; rootDomain: string }) {
  const { t } = useI18n()
  if (!domains?.length) return <span className="text-sm text-muted-foreground">{t.common.none}</span>
  return (
    <ul className="flex flex-col gap-1">
      {domains.map((d) => {
        const host = domainDisplayHost(d.domain, rootDomain)
        return (
          <li key={d.domain} className="flex flex-wrap items-center gap-x-1.5 text-sm break-all">
            {d.is_active ? (
              <a href={`http://${host}`} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                {host}
              </a>
            ) : (
              <span className="text-muted-foreground line-through">{host}</span>
            )}
            {d.is_primary && <Badge variant="secondary">{t.common.primary}</Badge>}
            {!d.is_active && <span className="text-xs text-muted-foreground">{t.common.off}</span>}
          </li>
        )
      })}
    </ul>
  )
}

function RowActions({ row, ready, className }: { row: BusinessRow; ready: boolean; className?: string }) {
  const { t, fmt } = useI18n()
  return (
    <div className={"flex items-center gap-1 " + (className ?? "")}>
      <Button variant={ready ? "ghost" : "outline"} size="sm" asChild>
        <Link href={`/businesses/${row.business_id}`}>
          {ready ? (
            <>
              <Pencil className="h-4 w-4" aria-hidden />
              {t.common.edit}
            </>
          ) : (
            t.common.continueSetup
          )}
          <span className="sr-only"> {row.business_name}</span>
        </Link>
      </Button>
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/businesses/${row.business_id}/zones`}>
          <MapPinned className="h-4 w-4" aria-hidden />
          {t.dashboard.zones}
          <span className="sr-only">{fmt(t.dashboard.zonesFor, { name: row.business_name })}</span>
        </Link>
      </Button>
    </div>
  )
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        "inline-flex h-8 items-center gap-1.5 rounded-[5px] px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 " +
        (active ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")
      }
    >
      {children}
    </button>
  )
}

function formatDate(iso: string, locale: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? "—"
    : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Rome" }).format(d)
}
