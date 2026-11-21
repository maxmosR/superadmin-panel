"use client"

import type React from "react"
import { useCallback, useEffect, useState } from "react"
import { Copy, Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/lib/i18n/client"
import { apiError } from "@/lib/i18n/api-error"
import type { OrderDevice } from "@/lib/order-devices"
import { useConfirm } from "./confirm-dialog"
import { Field } from "./field"

type Pairing = { code: string; expiresAt: string }

/**
 * The restaurant's order-receiver devices (/api/businesses/order-devices):
 * pair a new one with a one-time code (shown once, with its expiry), list
 * them, revoke one.
 */
export function OrderDevicesPanel({ businessId }: { businessId: string }) {
  const { t, fmt, locale } = useI18n()
  const { confirm, dialog } = useConfirm()
  const [devices, setDevices] = useState<OrderDevice[] | null>(null)
  const [label, setLabel] = useState("")
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [expired, setExpired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)

  const dateTime = useCallback(
    (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Rome" }).format(new Date(iso)),
    [locale],
  )

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/businesses/order-devices?business_id=${businessId}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(fmt(t.devices.loadFailed, { reason: apiError(t, j.error, res.status) }))
        return
      }
      setDevices(j.devices ?? [])
    } catch {
      setError(fmt(t.devices.loadFailed, { reason: t.common.network }))
    }
  }, [businessId, t, fmt])

  useEffect(() => {
    void load()
  }, [load])

  // The code stops working at its expiry: say so instead of showing a dead code.
  useEffect(() => {
    if (!pairing) return
    const ms = new Date(pairing.expiresAt).getTime() - Date.now()
    const timer = setTimeout(() => setExpired(true), Math.max(0, ms))
    return () => clearTimeout(timer)
  }, [pairing])

  const pair = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/businesses/order-devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, label: label.trim() || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(t.devices.errors[j.error] ?? apiError(t, j.error, res.status))
        return
      }
      setExpired(false)
      setCopied(false)
      setPairing({ code: j.code, expiresAt: j.expires_at })
      setLabel("")
    } catch {
      setError(t.common.network)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (device: OrderDevice) => {
    const name = device.label || t.devices.unnamed
    const ok = await confirm({
      title: fmt(t.devices.revokeTitle, { name }),
      description: <p>{t.devices.revokeBody}</p>,
      confirmLabel: t.devices.revokeConfirm,
      destructive: true,
    })
    if (!ok) return
    setError("")
    try {
      const res = await fetch("/api/businesses/order-devices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, device_id: device.id }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) setError(apiError(t, j.error, res.status))
    } catch {
      setError(t.common.network)
    }
    void load()
  }

  const copy = async () => {
    if (!pairing) return
    try {
      await navigator.clipboard.writeText(pairing.code)
      setCopied(true)
    } catch {
      // Clipboard blocked: the code is still visible and selectable.
    }
  }

  return (
    <div className="space-y-4">
      {pairing ? (
        <div className="space-y-2 rounded-lg border bg-muted/40 p-4" role="status">
          <p className="text-sm font-medium">{t.devices.codeTitle}</p>
          {expired ? (
            <p className="text-sm text-amber-700">{t.devices.codeExpired}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <code className="rounded-md border bg-background px-3 py-1.5 font-mono text-2xl tracking-widest select-all">{pairing.code}</code>
                <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  <span aria-live="polite">{copied ? t.devices.copied : t.devices.copy}</span>
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {t.devices.codeHelp} {fmt(t.devices.codeExpires, { time: dateTime(pairing.expiresAt) })}
              </p>
            </>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setPairing(null)
              void load()
            }}
          >
            {t.devices.done}
          </Button>
        </div>
      ) : (
        <form onSubmit={pair} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <Field label={t.devices.labelField}>
              {(p) => (
                <Input {...p} value={label} maxLength={60} placeholder={t.devices.labelPlaceholder} onChange={(e) => setLabel(e.target.value)} disabled={busy} />
              )}
            </Field>
          </div>
          <Button type="submit" size="sm" disabled={busy}>
            {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            {busy ? t.devices.pairing : t.devices.pair}
          </Button>
        </form>
      )}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {devices === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
      ) : devices.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.devices.empty}</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">{d.label || t.devices.unnamed}</p>
                <p className="text-xs text-muted-foreground">
                  {fmt(t.devices.created, { date: dateTime(d.created_at) })} ·{" "}
                  {d.last_seen_at ? fmt(t.devices.lastSeen, { date: dateTime(d.last_seen_at) }) : t.devices.neverSeen}
                </p>
              </div>
              {d.revoked_at ? (
                <Badge variant="outline" className="text-muted-foreground">
                  {fmt(t.devices.revoked, { date: dateTime(d.revoked_at) })}
                </Badge>
              ) : (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-green-700/40 text-green-700">
                    {t.devices.active}
                  </Badge>
                  <Button type="button" size="sm" variant="outline" onClick={() => void revoke(d)}>
                    {t.devices.revoke}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {dialog}
    </div>
  )
}
