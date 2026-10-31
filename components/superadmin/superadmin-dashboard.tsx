"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CheckCircle2, Loader2, MapPinned, Pencil, Plus, Search } from "lucide-react"
import { domainDisplayHost } from "@/lib/domains"
import { getReadiness } from "@/lib/readiness"
import { ConsoleShell, PageHead } from "./console-shell"
import { SetupSummary } from "./setup-status"
import { CreateBusinessDialog } from "./create-business-dialog"
import { EditBusinessDialog, type EditFocus } from "./edit-business-dialog"
import { ProvidersManager } from "./providers-manager"
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
  const [businesses, setBusinesses] = useState<BusinessRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<{ row: BusinessRow; focus?: EditFocus; trigger?: HTMLElement } | null>(null)
  // Short confirmation after a save, read out by screen readers too.
  const [notice, setNotice] = useState("")
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const announce = useCallback((text: string) => {
    setNotice(text)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(""), 6000)
  }, [])
  // "Continue setup" clicked before the new restaurant is in the list: open it on the next load.
  const pendingEditId = useRef<string | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<"all" | "setup">("all")

  const hasLoaded = useRef(false)
  const load = useCallback(async () => {
    // Only the first load shows the spinner; refreshes after a save keep the
    // table (and the focused row button) in place.
    if (!hasLoaded.current) setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/businesses")
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Failed to load (${res.status})`)
      }
      const j = await res.json()
      const rows: BusinessRow[] = j.businesses ?? []
      hasLoaded.current = true
      setBusinesses(rows)
      // Keep an open edit dialog on fresh data (staff or payout changes reload the list).
      const pending = pendingEditId.current && rows.find((r) => r.business_id === pendingEditId.current)
      if (pending) pendingEditId.current = null
      setEditing((e) => {
        if (pending) return { row: pending }
        if (!e) return e
        const row = rows.find((r) => r.business_id === e.row.business_id)
        return row ? { ...e, row } : null
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load restaurants")
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
        title="Restaurants"
        description="Set up restaurants, their owners and staff, and get them ready to take orders."
        action={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            New restaurant
          </Button>
        }
      />

      <p role="status" aria-live="polite" className={notice ? "mb-4 flex items-center gap-2 text-sm font-medium text-green-700" : "sr-only"}>
        {notice && <CheckCircle2 className="h-4 w-4" aria-hidden />}
        {notice}
      </p>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Couldn&apos;t load the restaurants: {error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
          <div role="group" aria-label="Show" className="inline-flex rounded-md border bg-muted/50 p-0.5">
            <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>
              All <span className="tabular-nums text-muted-foreground">{loading ? "" : businesses.length}</span>
            </FilterButton>
            <FilterButton active={filter === "setup"} onClick={() => setFilter("setup")}>
              Needs setup <span className="tabular-nums text-muted-foreground">{loading ? "" : needsSetup}</span>
            </FilterButton>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              className="pl-9"
              placeholder="Search name, slug or domain"
              aria-label="Search restaurants"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground" role="status">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            Loading restaurants…
          </div>
        ) : businesses.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="font-medium">No restaurants yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create the first one with its owner; the setup checklist takes it from there.</p>
            <Button className="mt-4" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              New restaurant
            </Button>
          </div>
        ) : shown.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted-foreground">
            {filter === "setup" && !query ? "Every restaurant is ready to take orders." : "No restaurant matches this search."}{" "}
            <button
              type="button"
              className="font-medium text-primary underline-offset-2 hover:underline"
              onClick={() => {
                setQuery("")
                setFilter("all")
              }}
            >
              Show all
            </button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4 sm:pl-6">Restaurant</TableHead>
                <TableHead>Setup</TableHead>
                <TableHead>Domains</TableHead>
                <TableHead>Payout account</TableHead>
                <TableHead className="pr-4 text-right sm:pr-6">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map(({ row: b, readiness }) => (
                <TableRow key={b.business_id} className="align-top">
                  <TableCell className="min-w-[12rem] py-3 pl-4 whitespace-normal sm:pl-6">
                    <div className="font-medium">{b.business_name}</div>
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">{b.slug}</div>
                    <div className="text-xs text-muted-foreground">
                      {b.config?.currency ?? "EUR"} · created {formatDate(b.created_at)}
                    </div>
                  </TableCell>
                  <TableCell className="min-w-[13rem] py-3 whitespace-normal">
                    <SetupSummary readiness={readiness} />
                  </TableCell>
                  <TableCell className="max-w-[15rem] py-3 whitespace-normal">
                    {b.domains?.length ? (
                      <ul className="flex flex-col gap-1">
                        {b.domains.map((d) => {
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
                              {d.is_primary && <Badge variant="secondary">primary</Badge>}
                              {!d.is_active && <span className="text-xs text-muted-foreground">off</span>}
                            </li>
                          )
                        })}
                      </ul>
                    ) : (
                      <span className="text-sm text-muted-foreground">None</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3">
                    <PayoutAccountCell businessId={b.business_id} businessName={b.business_name} account={b.payout_account ?? null} onCreated={load} />
                  </TableCell>
                  <TableCell className="py-3 pr-4 text-right sm:pr-6">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant={readiness.ready ? "ghost" : "outline"}
                        size="sm"
                        data-edit-restaurant={b.business_id}
                        onClick={(e) => setEditing({ row: b, trigger: e.currentTarget })}
                      >
                        {readiness.ready ? (
                          <>
                            <Pencil className="h-4 w-4" aria-hidden />
                            Edit
                          </>
                        ) : (
                          "Continue setup"
                        )}
                        <span className="sr-only"> {b.business_name}</span>
                      </Button>
                      <Button variant="ghost" size="sm" asChild>
                        <a href={`/businesses/${b.business_id}/zones`}>
                          <MapPinned className="h-4 w-4" aria-hidden />
                          Zones
                          <span className="sr-only"> for {b.business_name}</span>
                        </a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ProvidersManager />

      <CreateBusinessDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rootDomain={rootDomain}
        onCreated={() => {
          void load()
        }}
        onContinue={(id) => {
          const row = businesses.find((b) => b.business_id === id)
          if (row) setEditing({ row })
          else pendingEditId.current = id
        }}
      />

      <EditBusinessDialog
        business={editing?.row ?? null}
        focus={editing?.focus}
        returnFocus={editing?.trigger}
        onDone={(name) => announce(`Saved changes to ${name}.`)}
        onOpenChange={(open) => !open && setEditing(null)}
        rootDomain={rootDomain}
        onSaved={load}
      />
    </ConsoleShell>
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

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Rome" })
function formatDate(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "—" : dateFormat.format(d)
}
