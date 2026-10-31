"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2 } from "lucide-react"
import { ConsoleShell, PageHead } from "./console-shell"
import { useConfirm } from "./confirm-dialog"

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
  const [items, setItems] = useState<NavItem[]>([])
  const [rows, setRows] = useState<BusinessRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")

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
      } else setError(j.error || "Could not load the sections")
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const save = async (businessId: string, hidden: string[], previous: string[]) => {
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
    if (!res.ok) setError(j.error || "Saving failed")
    setRows((rs) => rs.map((r) => (r.business_id === businessId ? { ...r, hidden_items: stored } : r)))
    setSaving((s) => {
      const next = new Set(s)
      next.delete(businessId)
      return next
    })
  }

  const toggle = (row: BusinessRow, key: string) => {
    const hidden = row.hidden_items.includes(key)
      ? row.hidden_items.filter((k) => k !== key)
      : [...row.hidden_items, key]
    void save(row.business_id, hidden, row.hidden_items)
  }

  const setAll = async (row: BusinessRow, visible: boolean) => {
    if (!visible) {
      const ok = await confirm({
        title: `Hide every section for ${row.business_name}?`,
        description: `All ${items.length} sections leave its admin panel menu and their pages answer “not found” from the restaurant's next page load. Staff can't take or manage orders from the panel until you show them again.`,
        confirmLabel: "Hide all sections",
        destructive: true,
      })
      if (!ok) return
    }
    void save(row.business_id, visible ? [] : items.map((i) => i.key), row.hidden_items)
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.business_name.toLowerCase().includes(q) || (r.slug ?? "").includes(q))
  }, [rows, query])

  return (
    <ConsoleShell adminEmail={adminEmail}>
      <PageHead
        title="Admin panel sections"
        description="Which sections each restaurant's admin panel shows. Unchecked sections leave the menu, their pages answer 404 and their code isn't sent. Changes save at once and apply on the restaurant's next page load."
      />

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">{loading ? "Loading…" : `${rows.length} restaurant${rows.length === 1 ? "" : "s"}`}</CardTitle>
          <Input
            className="w-full sm:w-64"
            placeholder="Filter restaurants"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter restaurants"
          />
        </CardHeader>
        <CardContent>
          {loading ? (
            <span className="flex items-center text-sm text-muted-foreground" role="status">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Loading sections…
            </span>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="sticky left-0 z-10 min-w-[200px] bg-muted px-3 py-2 text-left font-medium">
                      Restaurant
                    </th>
                    {items.map((item) => (
                      <th key={item.key} scope="col" className="px-2 py-2 text-center text-xs font-medium whitespace-nowrap">
                        {item.label}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-center text-xs font-medium">All</th>
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
                            {busy && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                          </div>
                          {row.slug && <div className="text-xs text-muted-foreground">{row.slug}</div>}
                        </th>
                        {items.map((item) => (
                          <td key={item.key} className="px-2 py-2 text-center">
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-wait"
                              checked={!row.hidden_items.includes(item.key)}
                              disabled={busy}
                              onChange={() => toggle(row, item.key)}
                              aria-label={`${item.label} for ${row.business_name}`}
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2 text-center whitespace-nowrap">
                          <Button size="sm" variant="ghost" disabled={busy} aria-label={`Show all sections for ${row.business_name}`} onClick={() => void setAll(row, true)}>
                            Show all
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy} aria-label={`Hide all sections for ${row.business_name}`} onClick={() => void setAll(row, false)}>
                            Hide all
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={items.length + 2} className="px-3 py-6 text-center text-muted-foreground">
                        No restaurants match.
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
