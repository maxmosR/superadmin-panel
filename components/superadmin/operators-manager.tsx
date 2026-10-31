"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2 } from "lucide-react"
import { ConsoleShell, PageHead } from "./console-shell"

interface Operator {
  user_id: string
  email: string | null
  is_active: boolean
  created_at: string
}

// Platform operators: activate / deactivate. The API refuses to deactivate
// the last active operator.
export function OperatorsManager({ adminEmail = null }: { adminEmail?: string | null }) {
  const [operators, setOperators] = useState<Operator[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch("/api/operators", { cache: "no-store" })
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      setOperators(j.operators ?? [])
      setMe(j.me ?? null)
    } else setError(j.error || "Could not load operators")
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (op: Operator) => {
    setBusy(op.user_id)
    setError("")
    const res = await fetch("/api/operators", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: op.user_id, is_active: !op.is_active }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) setError(j.error === "last_operator" ? "The last active operator can't be deactivated." : j.error || "Update failed")
    await load()
    setBusy(null)
  }

  return (
    <ConsoleShell adminEmail={adminEmail} width="narrow">
      <PageHead title="Operators" description="BirraOra staff who can use this console. The last active operator can't be deactivated." />
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? "Loading…" : `${operators.length} operator${operators.length === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center py-6 text-sm text-muted-foreground" role="status">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Loading operators…
            </div>
          ) : (
            <ul className="divide-y">
              {operators.map((op) => (
                <li key={op.user_id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">
                      {op.email ?? op.user_id}
                      {op.user_id === me ? " (you)" : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">{op.is_active ? "Active" : "Inactive"}</div>
                  </div>
                  <Button size="sm" variant="outline" disabled={busy === op.user_id} onClick={() => void toggle(op)}>
                    {op.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </ConsoleShell>
  )
}
