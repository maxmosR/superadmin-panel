"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Check, Loader2, Pencil, Plus, Star, Trash2, X } from "lucide-react"
import { domainDisplayHost, domainKind } from "@/lib/domains"
import { useConfirm } from "./confirm-dialog"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"

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
export function DomainManager({
  businessId,
  rootDomain,
  showTitle = true,
  onChanged,
}: {
  businessId: string
  rootDomain: string
  /** False when the surrounding section already titles it. */
  showTitle?: boolean
  /** A domain was added, changed or removed (readiness may change). */
  onChanged?: () => void
}) {
  const { confirm, dialog } = useConfirm()
  const { t, fmt } = useI18n()
  // Latest strings for the loader, so switching language doesn't refetch.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
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
      if (!res.ok) throw new Error(apiError(tRef.current, j.error, res.status))
      setDomains(j.domains ?? [])
    } catch (e) {
      setError(e instanceof Error && !(e instanceof TypeError) ? e.message : tRef.current.domains.loadFailed)
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
      if (!res.ok) throw new Error(apiError(t, j.error, res.status))
      await load()
      onChanged?.()
      return true
    } catch (e) {
      setError(e instanceof Error && !(e instanceof TypeError) ? e.message : t.common.network)
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

  const toggleActive = async (row: DomainRow) => {
    const host = domainDisplayHost(row.domain, rootDomain)
    if (row.is_active) {
      const ok = await confirm({
        title: fmt(t.domains.disableTitle, { host }),
        description: t.domains.disableBody,
        confirmLabel: t.domains.disable,
        destructive: true,
      })
      if (!ok) return false
    }
    return call(`active:${row.domain}`, {
      method: "PATCH",
      body: JSON.stringify({ business_id: businessId, domain: row.domain, is_active: !row.is_active }),
    })
  }

  const remove = async (domain: string) => {
    const host = domainDisplayHost(domain, rootDomain)
    const ok = await confirm({
      title: fmt(t.domains.removeTitle, { host }),
      description: (
        <>
          <p>{t.domains.removeBody1}</p>
          <p>{t.domains.removeBody2}</p>
        </>
      ),
      confirmLabel: t.domains.removeConfirm,
      destructive: true,
    })
    if (!ok) return false
    return call(`del:${domain}`, {
      method: "DELETE",
      url: `/api/businesses/domains?business_id=${encodeURIComponent(businessId)}&domain=${encodeURIComponent(domain)}`,
    })
  }

  return (
    <section className="space-y-3">
      <div>
        {showTitle && <h3 className="text-sm font-semibold">{t.domains.title}</h3>}
        <p className={showTitle ? "mt-1 text-xs text-muted-foreground" : "text-xs text-muted-foreground"}>
          {t.domains.intro1}
          <code>acme</code> → <code>acme.{rootDomain}</code>
          {t.domains.intro2}
          <code>shop.acme.com</code>
          {t.domains.intro3}
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t.domains.loading}
        </div>
      ) : (
        <ul className="divide-y rounded-md border">
          {domains.length === 0 && (
            <li className="px-3 py-4 text-sm text-muted-foreground">{t.domains.empty}</li>
          )}
          {domains.map((row) => {
            const isEditing = editingDomain === row.domain
            const rowBusy = busy?.endsWith(`:${row.domain}`) ?? false

            return (
              <li key={row.domain} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                {isEditing ? (
                  <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                    <Input
                      aria-label={t.domains.domainField}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value.toLowerCase())}
                      className="sm:max-w-[260px]"
                      placeholder={t.domains.placeholder}
                    />
                    <Input
                      aria-label={t.domains.noteField}
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="sm:max-w-[200px]"
                      placeholder={t.domains.notePlaceholder}
                    />
                  </div>
                ) : (
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-mono text-sm">{domainDisplayHost(row.domain, rootDomain)}</span>
                      {row.is_primary && (
                        <Badge variant="outline" className="gap-1">
                          <Star className="h-3 w-3" aria-hidden />
                          {t.common.primary}
                        </Badge>
                      )}
                      {!row.is_active && <Badge variant="secondary">{t.domains.disabled}</Badge>}
                      <Badge variant="outline">{t.domains.kind[domainKind(row.domain)] ?? domainKind(row.domain)}</Badge>
                    </div>
                    {row.label && <div className="mt-0.5 truncate text-xs text-muted-foreground">{row.label}</div>}
                  </div>
                )}

                <div className="flex shrink-0 items-center gap-1">
                  {rowBusy && <Loader2 className="mr-1 h-4 w-4 animate-spin text-muted-foreground" />}

                  {isEditing ? (
                    <>
                      <Button size="sm" variant="ghost" aria-label={t.domains.save} title={t.common.save} onClick={() => handleSaveEdit(row.domain)} disabled={!!busy}>
                        <Check className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={t.domains.cancelEdit} title={t.common.cancel} onClick={() => setEditingDomain(null)} disabled={!!busy}>
                        <X className="h-4 w-4" aria-hidden />
                      </Button>
                    </>
                  ) : (
                    <>
                      {!row.is_primary && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title={t.domains.makePrimaryTitle}
                          aria-label={fmt(t.domains.makePrimary, { host: domainDisplayHost(row.domain, rootDomain) })}
                          onClick={() => setPrimary(row.domain)}
                          disabled={!!busy}
                        >
                          <Star className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        title={t.domains.editTitle}
                        aria-label={fmt(t.domains.editLabel, { host: domainDisplayHost(row.domain, rootDomain) })}
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
                        title={row.is_active ? t.domains.disable : t.domains.enable}
                        aria-label={fmt(row.is_active ? t.domains.disableLabel : t.domains.enableLabel, { host: domainDisplayHost(row.domain, rootDomain) })}
                        onClick={() => void toggleActive(row)}
                        disabled={!!busy || row.is_primary}
                      >
                        {row.is_active ? <X className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title={t.common.remove}
                        aria-label={fmt(t.domains.removeLabel, { host: domainDisplayHost(row.domain, rootDomain) })}
                        onClick={() => void remove(row.domain)}
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
          <Label htmlFor={`${businessId}-new-domain`} className="text-sm">{t.domains.addDomain}</Label>
          <Input
            id={`${businessId}-new-domain`}
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value.toLowerCase())}
            placeholder={t.domains.placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleAdd()
              }
            }}
          />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`${businessId}-new-note`} className="text-sm">{t.domains.noteOptional}</Label>
          <Input id={`${businessId}-new-note`} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder={t.domains.notePlaceholderAdd} />
        </div>
        <Button variant="outline" onClick={handleAdd} disabled={!!busy || !newDomain.trim()}>
          {busy === "add" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          {t.common.add}
        </Button>
      </div>
      {dialog}
    </section>
  )
}
