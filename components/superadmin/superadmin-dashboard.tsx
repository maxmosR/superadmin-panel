"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, LogOut, Pencil, Plus, ShieldCheck } from "lucide-react"
import { domainDisplayHost } from "@/lib/domains"
import { CreateBusinessDialog } from "./create-business-dialog"
import { EditBusinessDialog } from "./edit-business-dialog"
import { ProvidersManager } from "./providers-manager"

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
  } | null
  owner: { email: string | null; first_name: string | null; last_name: string | null } | null
}

export function SuperAdminDashboard({
  adminEmail,
  rootDomain,
}: {
  adminEmail: string | null
  rootDomain: string
}) {
  const router = useRouter()
  const supabase = createClient()
  const [businesses, setBusinesses] = useState<BusinessRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<BusinessRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/businesses")
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Failed to load (${res.status})`)
      }
      const j = await res.json()
      setBusinesses(j.businesses ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load businesses")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <span className="font-semibold">Super Admin</span>
          </div>
          <div className="flex items-center gap-3">
            {adminEmail && <span className="hidden text-sm text-muted-foreground sm:inline">{adminEmail}</span>}
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Businesses</h1>
            <p className="text-sm text-muted-foreground">Provision new business accounts and their owner logins.</p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create business
          </Button>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {loading ? "Loading…" : `${businesses.length} business${businesses.length === 1 ? "" : "es"}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Loading businesses…
              </div>
            ) : businesses.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No businesses yet. Click “Create business” to add one.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Business</TableHead>
                      <TableHead>Domains</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {businesses.map((b) => (
                      <TableRow key={b.business_id}>
                        <TableCell>
                          <div className="font-medium">{b.business_name}</div>
                          <div className="text-xs text-muted-foreground">{b.name_abbreviation}</div>
                        </TableCell>
                        <TableCell>
                          {b.domains?.length ? (
                            <div className="flex flex-col gap-1">
                              {b.domains.map((d) => {
                                const host = domainDisplayHost(d.domain, rootDomain)
                                return (
                                  <div key={d.domain} className="flex items-center gap-1.5">
                                    <a
                                      href={`http://${host}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={
                                        d.is_active
                                          ? "text-primary underline underline-offset-2"
                                          : "text-muted-foreground line-through"
                                      }
                                    >
                                      {host}
                                    </a>
                                    {d.is_primary && <Badge className="h-4 px-1 text-[10px]">primary</Badge>}
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <Badge variant="secondary">none</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{b.owner?.email ?? "—"}</TableCell>
                        <TableCell className="text-sm">{b.config?.currency ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(b.created_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => setEditing(b)}>
                            <Pencil className="mr-1 h-4 w-4" />
                            Edit
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

        <ProvidersManager />
      </main>

      <CreateBusinessDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        rootDomain={rootDomain}
        onCreated={load}
      />

      <EditBusinessDialog
        business={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        rootDomain={rootDomain}
        onSaved={load}
      />
    </div>
  )
}
