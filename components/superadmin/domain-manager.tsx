"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Check, Loader2, Pencil, Plus, Star, Trash2, X } from "lucide-react"
import { domainDisplayHost, domainKind } from "@/lib/domains"

export interface DomainRow {
  domain: string
  is_primary: boolean
  is_active: boolean
  label: string | null
  created_at?: string
}

/**
 * Add / rename / re-point / deactivate / delete the domains of one business.
 *
 * A tenant is identified ONLY by the host it is reached on — the request host
 * is what the backend turns into a business_id — so every domain listed here
 * is a live entry point for this business, and the list can never be emptied.
 */
export function DomainManager({ businessId, rootDomain }: { businessId: string; rootDomain: string }) {
  const [domains, setDomains] = useState<DomainRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")

  const [newDomain, setNewDomain] = useState("")
  const [newLabel, setNewLabel] = useState("")

  const [editingDomain, setEditingDomain] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")
  const [editLabel, setEditLabel] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch(`/api/businesses/domains?business_id=${encodeURIComponent(businessId)}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `Failed to load domains (${res.status})`)
      setDomains(j.domains ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load domains")
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    load()
  }, [load])

  const call = async (key: string, init: RequestInit & { url?: string }) => {
    setBusy(key)
    setError("")
    try {
      const { url, ...rest } = init
      const res = await fetch(url ?? "/api/businesses/domains", {
        ...rest,
        headers: rest.body ? { "Content-Type": "application/json" } : undefined,
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`)
      await load()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed")
      return false
    } finally {
      setBusy(null)
    }
  }

  const handleAdd = async () => {
    if (!newDomain.trim()) return
    const ok = await call("add", {
      method: "POST",
      body: JSON.stringify({
        business_id: businessId,
        domain: newDomain,
        label: newLabel || null,
      }),
    })
    if (ok) {
      setNewDomain("")
      setNewLabel("")
    }
  }

  const handleSaveEdit = async (domain: string) => {
    const ok = await call(`edit:${domain}`, {
      method: "PATCH",
      body: JSON.stringify({
        business_id: businessId,
        domain,
        new_domain: editValue,
        label: editLabel || null,
      }),
    })
    if (ok) setEditingDomain(null)
  }

  const setPrimary = (domain: string) =>
    call(`primary:${domain}`, {
      method: "PATCH",
      body: JSON.stringify({ business_id: businessId, domain, is_primary: true, is_active: true }),
    })

  const toggleActive = (row: DomainRow) =>
    call(`active:${row.domain}`, {
      method: "PATCH",
      body: JSON.stringify({ business_id: businessId, domain: row.domain, is_active: !row.is_active }),
    })

  const remove = (domain: string) =>
    call(`del:${domain}`, {
      method: "DELETE",
      url: `/api/businesses/domains?business_id=${encodeURIComponent(businessId)}&domain=${encodeURIComponent(domain)}`,
    })

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground">Domains</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Every request is mapped to this business by its host. Add a bare label (<code>acme</code> →{" "}
          <code>acme.{rootDomain}</code>) or a full hostname (<code>shop.acme.com</code>). The primary domain is the one
          shown as the tenant&rsquo;s canonical address.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading domains…
        </div>
      ) : (
        <ul className="divide-y rounded-md border">
          {domains.length === 0 && (
            <li className="px-3 py-4 text-sm text-muted-foreground">No domains yet — add one below.</li>
          )}
          {domains.map((row) => {
            const isEditing = editingDomain === row.domain
            const rowBusy = busy?.endsWith(`:${row.domain}`) ?? false

            return (
              <li key={row.domain} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                {isEditing ? (
                  <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value.toLowerCase())}
                      className="sm:max-w-[260px]"
                      placeholder="acme or shop.acme.com"
                    />
                    <Input
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="sm:max-w-[200px]"
                      placeholder="Note (optional)"
                    />
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-sm">{domainDisplayHost(row.domain, rootDomain)}</span>
                      {row.is_primary && (
                        <Badge className="gap-1">
                          <Star className="h-3 w-3" />
                          primary
                        </Badge>
                      )}
                      {!row.is_active && <Badge variant="secondary">disabled</Badge>}
                      <Badge variant="outline">{domainKind(row.domain)}</Badge>
                    </div>
                    {row.label && <div className="mt-0.5 truncate text-xs text-muted-foreground">{row.label}</div>}
                  </div>
                )}

                <div className="flex shrink-0 items-center gap-1">
                  {rowBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin text-muted-foreground" />}

                  {isEditing ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => handleSaveEdit(row.domain)} disabled={!!busy}>
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingDomain(null)} disabled={!!busy}>
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      {!row.is_primary && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Make primary"
                          onClick={() => setPrimary(row.domain)}
                          disabled={!!busy}
                        >
                          <Star className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Rename / re-point"
                        onClick={() => {
                          setEditingDomain(row.domain)
                          setEditValue(row.domain)
                          setEditLabel(row.label ?? "")
                        }}
                        disabled={!!busy}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title={row.is_active ? "Disable" : "Enable"}
                        onClick={() => toggleActive(row)}
                        disabled={!!busy || row.is_primary}
                      >
                        {row.is_active ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Remove"
                        onClick={() => remove(row.domain)}
                        disabled={!!busy || domains.length <= 1}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label className="text-sm">Add domain</Label>
          <Input
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value.toLowerCase())}
            placeholder="acme or shop.acme.com"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleAdd()
              }
            }}
          />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label className="text-sm">Note (optional)</Label>
          <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. marketing site" />
        </div>
        <Button onClick={handleAdd} disabled={!!busy || !newDomain.trim()}>
          {busy === "add" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Add
        </Button>
      </div>
    </section>
  )
}
