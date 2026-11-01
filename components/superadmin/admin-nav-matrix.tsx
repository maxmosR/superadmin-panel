"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2 } from "lucide-react"
import { ConsoleShell, PageHead } from "./console-shell"
import { useConfirm } from "./confirm-dialog"
import { useUndoToast } from "./undo-toast"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"

interface NavItem {
  key: string
  label: string
}

interface BusinessRow {
  business_id: string
  business_name: string
  slug: string | null
  hidden_items: string[]
}

// Rows: restaurants. Columns: admin-panel sections. A checked box means the
// restaurant's admin panel shows that section. Every click saves at once
// (PUT /api/admin-nav); the restaurant sees it on its next page load.
export function AdminNavMatrix({ adminEmail = null }: { adminEmail?: string | null }) {
  const { confirm, dialog } = useConfirm()
  const { offer } = useUndoToast()
  const { t, fmt } = useI18n()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const [items, setItems] = useState<NavItem[]>([])
  const [rows, setRows] = useState<BusinessRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [onlyHidden, setOnlyHidden] = useState(false)

  // Loaded once; `loading` starts true, so nothing is set before the fetch.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch("/api/admin-nav", { cache: "no-store" })
      const j = await res.json().catch(() => ({}))
      if (cancelled) return
      if (res.ok) {
        setItems(j.items ?? [])
        setRows(j.businesses ?? [])
      } else setError(j.error ? apiError(tRef.current, j.error, res.status) : tRef.current.sections.loadFailed)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** True when the database took the change. */
  const save = async (businessId: string, hidden: string[], previous: string[]): Promise<boolean> => {
    setSaving((s) => new Set(s).add(businessId))
    setError("")
    setRows((rs) => rs.map((r) => (r.business_id === businessId ? { ...r, hidden_items: hidden } : r)))
    const res = await fetch("/api/admin-nav", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: businessId, hidden_items: hidden }),
    })
    const j = await res.json().catch(() => ({}))
    // Keep what the database stored; on failure put the previous value back.
    const stored: string[] = res.ok ? (j.hidden_items ?? hidden) : previous
    if (!res.ok) setError(`${t.sections.saveFailed}${j.error ? ` (${apiError(t, j.error, res.status)})` : ""}`)
    setRows((rs) => rs.map((r) => (r.business_id === businessId ? { ...r, hidden_items: stored } : r)))
    setSaving((s) => {
      const next = new Set(s)
      next.delete(businessId)
      return next
    })
    return res.ok
  }

  const undoTo = (businessId: string, previous: string[], now: string[]) => async () => {
    if (!(await save(businessId, previous, now))) throw new Error("undo failed")
  }

  const toggle = async (row: BusinessRow, key: string) => {
    const wasHidden = row.hidden_items.includes(key)
    const hidden = wasHidden ? row.hidden_items.filter((k) => k !== key) : [...row.hidden_items, key]
    if (!(await save(row.business_id, hidden, row.hidden_items))) return
    const section = t.sections.items[key] ?? items.find((i) => i.key === key)?.label ?? key
    offer(fmt(wasHidden ? t.sections.shownMsg : t.sections.hiddenMsg, { section, name: row.business_name }), undoTo(row.business_id, row.hidden_items, hidden))
  }

  const setAll = async (row: BusinessRow, visible: boolean) => {
    if (!visible) {
      const ok = await confirm({
        title: fmt(t.sections.hideTitle, { name: row.business_name }),
        description: fmt(t.sections.hideBody, { n: items.length }),
        confirmLabel: t.sections.hideConfirm,
        destructive: true,
      })
      if (!ok) return
    }
    const next = visible ? [] : items.map((i) => i.key)
    if (!(await save(row.business_id, next, row.hidden_items))) return
    offer(fmt(visible ? t.sections.allShownMsg : t.sections.allHiddenMsg, { name: row.business_name }), undoTo(row.business_id, row.hidden_items, next))
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(
      (r) =>
        (!onlyHidden || r.hidden_items.length > 0) &&
        (!q || r.business_name.toLowerCase().includes(q) || (r.slug ?? "").includes(q)),
    )
  }, [rows, query, onlyHidden])
  const withHidden = rows.filter((r) => r.hidden_items.length > 0).length

  return (
    <ConsoleShell adminEmail={adminEmail}>
      <PageHead
        title={t.sections.title}
        description={t.sections.description}
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">{loading ? null : t.sections.count(rows.length)}</CardTitle>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Button
              size="sm"
              variant={onlyHidden ? "secondary" : "outline"}
              aria-pressed={onlyHidden}
              disabled={loading}
              onClick={() => setOnlyHidden((v) => !v)}
            >
              {fmt(t.sections.withHidden, { n: withHidden })}
            </Button>
            <Input
              className="w-full sm:w-64"
              placeholder={t.sections.filterPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t.sections.filterPlaceholder}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <span className="flex items-center text-sm text-muted-foreground" role="status">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              {t.sections.loading}
            </span>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="sticky left-0 z-10 min-w-[200px] bg-muted px-3 py-2 text-left font-medium">
                      {t.sections.restaurant}
                    </th>
                    {items.map((item) => (
                      <th key={item.key} scope="col" className="px-2 py-2 text-center text-xs font-medium whitespace-nowrap">
                        {t.sections.items[item.key] ?? item.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => {
                    const busy = saving.has(row.business_id)
                    return (
                      <tr key={row.business_id} className="border-b last:border-0 hover:bg-muted/30">
                        <th scope="row" className="sticky left-0 z-10 bg-background px-3 py-2 text-left font-normal">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{row.business_name}</span>
                            {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden />}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {row.slug && <span className="font-mono">{row.slug}</span>}
                            {row.slug && " · "}
                            {row.hidden_items.length === 0 ? (
                              t.sections.allShown
                            ) : (
                              <span className="text-amber-700">
                                {row.hidden_items.length === items.length ? t.sections.allHidden : fmt(t.sections.nHidden, { n: row.hidden_items.length })}
                              </span>
                            )}
                          </div>
                          <div className="-ml-2 mt-1 flex">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              disabled={busy || row.hidden_items.length === 0}
                              aria-label={fmt(t.sections.showAllLabel, { name: row.business_name })}
                              onClick={() => void setAll(row, true)}
                            >
                              {t.sections.showAll}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              disabled={busy || row.hidden_items.length === items.length}
                              aria-label={fmt(t.sections.hideAllLabel, { name: row.business_name })}
                              onClick={() => void setAll(row, false)}
                            >
                              {t.sections.hideAll}
                            </Button>
                          </div>
                        </th>
                        {items.map((item) => {
                          const hidden = row.hidden_items.includes(item.key)
                          return (
                          <td key={item.key} className={hidden ? "bg-amber-50 px-2 py-2 text-center" : "px-2 py-2 text-center"}>
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer accent-neutral-500 disabled:cursor-wait"
                              checked={!row.hidden_items.includes(item.key)}
                              disabled={busy}
                              onChange={() => void toggle(row, item.key)}
                              aria-label={fmt(t.sections.cellLabel, { section: t.sections.items[item.key] ?? item.label, name: row.business_name })}
                            />
                            {hidden && <span className="mt-0.5 block text-xs font-medium leading-none text-amber-700">{t.sections.hidden}</span>}
                          </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={items.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                        {t.sections.noMatch}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      {dialog}
    </ConsoleShell>
  )
}
