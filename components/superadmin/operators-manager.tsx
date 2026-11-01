"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2 } from "lucide-react"
import { ConsoleShell, PageHead } from "./console-shell"
import { useConfirm } from "./confirm-dialog"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"

interface Operator {
  user_id: string
  email: string | null
  is_active: boolean
  created_at: string
}

// Platform operators: activate / deactivate. The API refuses to deactivate
// the last active operator.
export function OperatorsManager({ adminEmail = null }: { adminEmail?: string | null }) {
  const { confirm, dialog } = useConfirm()
  const { t, fmt } = useI18n()
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])
  const [operators, setOperators] = useState<Operator[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    const res = await fetch("/api/operators", { cache: "no-store" })
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      setOperators(j.operators ?? [])
      setMe(j.me ?? null)
    } else setError(j.error ? apiError(tRef.current, j.error, res.status) : tRef.current.operators.loadFailed)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (op: Operator) => {
    if (op.is_active) {
      const ok = await confirm({
        title: fmt(t.operators.deactivateTitle, { who: op.email ?? t.operators.thisOperator }),
        description: t.operators.deactivateBody,
        confirmLabel: t.operators.deactivate,
        destructive: true,
      })
      if (!ok) return
    }
    setBusy(op.user_id)
    setError("")
    const res = await fetch("/api/operators", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: op.user_id, is_active: !op.is_active }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) setError(j.error ? apiError(t, j.error, res.status, { last_operator: t.operators.lastOperator }) : t.operators.updateFailed)
    await load()
    setBusy(null)
  }

  return (
    <ConsoleShell adminEmail={adminEmail} width="narrow">
      <PageHead title={t.operators.title} description={t.operators.description} />
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? t.operators.title : t.operators.count(operators.length)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center py-6 text-sm text-muted-foreground" role="status">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              {t.operators.loading}
            </div>
          ) : (
            <ul className="divide-y">
              {operators.map((op) => (
                <li key={op.user_id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">
                      {op.email ?? op.user_id}
                      {op.user_id === me ? t.operators.you : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">{op.is_active ? t.operators.active : t.operators.inactive}</div>
                  </div>
                  {op.user_id === me && op.is_active ? (
                    // Deactivating yourself would lock you out mid-session; another operator has to do it.
                    <span className="text-xs text-muted-foreground">{t.operators.askAnother}</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === op.user_id}
                      aria-label={`${op.is_active ? t.operators.deactivate : t.operators.activate} ${op.email ?? t.operators.thisOperator}`}
                      onClick={() => void toggle(op)}
                    >
                      {op.is_active ? t.operators.deactivate : t.operators.activate}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {dialog}
    </ConsoleShell>
  )
}
