"use client"

import { useCallback, useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { useConfirm } from "./confirm-dialog"

// "Staff and owners" of one restaurant (operator). Every change goes through
// /api/businesses/roles -> set_role_assignment; the last-owner refusal is
// shown as returned.

const ROLES = ["owner", "sala_boss", "worker", "accountant"] as const
type Role = (typeof ROLES)[number]
const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  sala_boss: "Floor manager",
  worker: "Worker",
  accountant: "Accountant",
}

interface Member {
  user_id: string
  role: Role
  first_name: string | null
  last_name: string | null
  phone: string | null
  email: string | null
}

const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm"

/** "Mario Rossi", else the masked contact, else a neutral fallback. */
function who(m: Member) {
  return [m.first_name, m.last_name].filter(Boolean).join(" ") || m.phone || m.email || "this person"
}

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
  const addId = useId()
  const [status, setStatus] = useState("")
  const where = businessName ?? "this restaurant"
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [identifier, setIdentifier] = useState("")
  const [role, setRole] = useState<Role>("owner")

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/businesses/roles?business_id=${encodeURIComponent(businessId)}`, { cache: "no-store" })
    const j = await res.json().catch(() => ({}))
    if (res.ok) setMembers(j.members ?? [])
    else setError(j.error || "Could not load staff")
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
          j.error === "last_owner"
            ? "A restaurant must keep at least one owner."
            : j.error === "invalid_identifier"
              ? "Enter a valid phone number or email."
              : j.error || "The change could not be saved.",
        )
        return false
      }
      await load()
      onChanged?.()
      setStatus(method === "DELETE" ? "Removed." : method === "POST" ? "Added." : "Role changed.")
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
          Loading staff…
        </div>
      ) : members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No staff yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{[m.first_name, m.last_name].filter(Boolean).join(" ") || "No name yet"}</div>
                <div className="text-xs text-muted-foreground font-mono">{m.phone ?? m.email ?? "—"}</div>
              </div>
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Role of ${who(m)}`}
                  className={selectClass}
                  value={m.role}
                  disabled={saving}
                  onChange={async (e) => {
                    const next = e.target.value as Role
                    // Owner changes decide who runs the restaurant: confirm them.
                    if (m.role === "owner" || next === "owner") {
                      const ok = await confirm({
                        title: next === "owner" ? `Make ${who(m)} an owner of ${where}?` : `Change ${who(m)} from owner to ${ROLE_LABEL[next].toLowerCase()}?`,
                        description:
                          next === "owner"
                            ? "Owners can manage staff, payouts and every setting in the restaurant's admin panel."
                            : "They lose owner rights in the restaurant's admin panel straight away. A restaurant must keep at least one owner.",
                        confirmLabel: "Change role",
                      })
                      if (!ok) return
                    }
                    void send("PATCH", { user_id: m.user_id, role: next })
                  }}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${who(m)}`}
                  title="Remove"
                  disabled={saving}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Remove ${who(m)} from ${where}?`,
                      description: `They lose access to the restaurant's admin panel straight away. You can add them again later as ${ROLE_LABEL[m.role].toLowerCase()} or another role.`,
                      confirmLabel: "Remove",
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
          Phone or email of the person to add
        </label>
        <Input
          id={addId}
          placeholder="Phone or email"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          disabled={saving}
        />
        <select aria-label="Role for the new person" className={selectClass} value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={saving}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <Button
          type="button"
          disabled={saving || !identifier.trim()}
          onClick={async () => {
            const v = identifier.trim()
            if (await send("POST", { identifier: v, kind: v.includes("@") ? "email" : "phone", role })) setIdentifier("")
          }}
        >
          <Plus className="h-4 w-4" aria-hidden /> Add
        </Button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      {dialog}
    </div>
  )
}
