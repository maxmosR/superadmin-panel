"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { useConfirm } from "./confirm-dialog"
import { useUndoToast } from "./undo-toast"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"

// "Staff and owners" of one restaurant (operator). Every change goes through
// /api/businesses/roles -> set_role_assignment; the last-owner refusal is
// shown as returned.

const ROLES = ["owner", "sala_boss", "worker", "accountant"] as const
type Role = (typeof ROLES)[number]

interface Member {
  user_id: string
  role: Role
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
}

const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm"


export function StaffRolesPanel({
  businessId,
  businessName,
  onChanged,
}: {
  businessId: string
  businessName?: string
  onChanged?: () => void
}) {
  const { confirm, dialog } = useConfirm()
  const { offer } = useUndoToast()
  const { t, fmt } = useI18n()
  const ROLE_LABEL = t.staff.roles
  /** "Mario Rossi", else the masked contact, else a neutral fallback. */
  const who = (m: Member) => [m.first_name, m.last_name].filter(Boolean).join(" ") || m.phone || m.email || t.staff.thisPerson
  const addId = useId()
  const [status, setStatus] = useState("")
  const where = businessName ?? t.staff.thisRestaurant
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [identifier, setIdentifier] = useState("")
  // A new person starts as staff: owner is the most powerful role, chosen on purpose.
  const [role, setRole] = useState<Role>("worker")

  // Latest strings for the loader, so switching language doesn't refetch.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/businesses/roles?business_id=${encodeURIComponent(businessId)}`, { cache: "no-store" })
    const j = await res.json().catch(() => ({}))
    if (res.ok) setMembers(j.members ?? [])
    else setError(j.error ? apiError(tRef.current, j.error, res.status) : tRef.current.staff.loadFailed)
    setLoading(false)
  }, [businessId])

  useEffect(() => {
    void load()
  }, [load])

  const send = async (method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>) => {
    setSaving(true)
    setError("")
    setStatus("")
    try {
      const res = await fetch("/api/businesses/roles", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, ...body }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(
          j.error
            ? apiError(t, j.error, res.status, { last_owner: t.staff.lastOwner, invalid_identifier: t.staff.invalidIdentifier })
            : t.staff.saveFailed,
        )
        return false
      }
      await load()
      onChanged?.()
      setStatus(method === "DELETE" ? t.staff.removed : method === "POST" ? t.staff.added : t.staff.roleChanged)
      return true
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {loading ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {t.staff.loading}
        </div>
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.staff.empty}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{[m.first_name, m.last_name].filter(Boolean).join(" ") || t.staff.noName}</div>
                <div className="text-xs text-muted-foreground font-mono">{m.phone ?? m.email ?? "—"}</div>
              </div>
              <div className="flex items-center gap-2">
                {/* Radix Select commits only on a real choice: arrow keys open and move
                    through the list without saving, unlike a native select, which
                    can fire a live role change on every key press. */}
                <Select
                  value={m.role}
                  disabled={saving}
                  onValueChange={async (value) => {
                    const next = value as Role
                    if (next === m.role) return
                    // Owner changes decide who runs the restaurant: confirm them.
                    if (m.role === "owner" || next === "owner") {
                      const ok = await confirm({
                        title:
                          next === "owner"
                            ? fmt(t.staff.makeOwnerTitle, { who: who(m), where })
                            : fmt(t.staff.dropOwnerTitle, { who: who(m), role: ROLE_LABEL[next].toLowerCase() }),
                        description: next === "owner" ? t.staff.makeOwnerBody : t.staff.dropOwnerBody,
                        confirmLabel: t.staff.changeRole,
                      })
                      if (!ok) return
                    }
                    const previous = m.role
                    const ok = await send("PATCH", { user_id: m.user_id, role: next })
                    if (ok)
                      offer(fmt(t.staff.roleChangedMsg, { who: who(m), role: ROLE_LABEL[next].toLowerCase() }), async () => {
                        if (!(await send("PATCH", { user_id: m.user_id, role: previous }))) throw new Error("undo failed")
                      })
                  }}
                >
                  <SelectTrigger size="sm" className="w-44" aria-label={fmt(t.staff.roleOf, { who: who(m) })}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={fmt(t.staff.removeLabel, { who: who(m) })}
                  title={t.common.remove}
                  disabled={saving}
                  onClick={async () => {
                    const ok = await confirm({
                      title: fmt(t.staff.removeTitle, { who: who(m), where }),
                      description: fmt(t.staff.removeBody, { role: ROLE_LABEL[m.role].toLowerCase() }),
                      confirmLabel: t.common.remove,
                      destructive: true,
                    })
                    if (ok) void send("DELETE", { user_id: m.user_id })
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={addId} className="sr-only">
          {t.staff.addLabel}
        </label>
        <Input
          id={addId}
          placeholder={t.staff.addPlaceholder}
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          disabled={saving}
        />
        <select aria-label={t.staff.newRole} className={selectClass} value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={saving}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          disabled={saving || !identifier.trim()}
          onClick={async () => {
            const v = identifier.trim()
            if (await send("POST", { identifier: v, kind: v.includes("@") ? "email" : "phone", role })) setIdentifier("")
          }}
        >
          <Plus className="h-4 w-4" aria-hidden /> {t.common.add}
        </Button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      {dialog}
    </div>
  )
}
