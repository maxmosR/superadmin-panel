"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Copy, KeyRound, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { LanguageSwitch, useI18n } from "@/lib/i18n/client"

type Enrolment = { factorId: string; qr: string; secret: string }

/**
 * Operator second factor (Supabase Auth TOTP), in the browser with the
 * operator's own session:
 * - enrol: drop any half-finished TOTP factor, `mfa.enroll` a new one, show
 *   its QR code and key, then `mfa.challenge` + `mfa.verify` the first code;
 * - challenge: `mfa.challengeAndVerify` with the verified TOTP factor.
 * A verified code upgrades the session to AAL2; the server pages and API
 * routes then let the operator in.
 */
export function MfaPanel({ mode }: { mode: "enroll" | "challenge" }) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const [supabase] = useState(() => createClient())
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(true)
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [copied, setCopied] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    // Once per mount (Strict Mode runs effects twice in development).
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
        if (listError) throw listError
        if (mode === "challenge") {
          const totp = factors.totp[0]
          if (!totp) {
            router.replace("/mfa/enroll")
            return
          }
          setFactorId(totp.id)
          return
        }
        // A factor left unverified by an earlier, abandoned attempt would
        // clash with the new one: remove it first.
        for (const f of factors.all) {
          if (f.factor_type === "totp" && f.status === "unverified") {
            await supabase.auth.mfa.unenroll({ factorId: f.id })
          }
        }
        const { data, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "BirraOra console",
          issuer: "BirraOra",
        })
        if (enrollError) throw enrollError
        setEnrolment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
        setFactorId(data.id)
      } catch (e) {
        setError(fmt(t.mfa.setupFailed, { reason: errorReason(e) }))
      } finally {
        setPreparing(false)
      }
    })()
  }, [supabase, mode, router, fmt, t])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!factorId) return
    setBusy(true)
    setError("")
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() })
      if (verifyError) {
        setError(
          verifyError.code === "mfa_verification_failed" || verifyError.status === 422
            ? t.mfa.wrongCode
            : fmt(t.mfa.verifyFailed, { reason: errorReason(verifyError) }),
        )
        return
      }
      router.replace("/")
      router.refresh()
    } catch (err) {
      setError(fmt(t.mfa.verifyFailed, { reason: errorReason(err) }))
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    router.replace("/login")
    router.refresh()
  }

  const copySecret = async () => {
    if (!enrolment) return
    try {
      await navigator.clipboard.writeText(enrolment.secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked: the key is still visible and selectable.
    }
  }

  const enrol = mode === "enroll"

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background p-4 sm:p-6">
      <LanguageSwitch className="absolute top-4 right-4" />
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" aria-hidden />
          </div>
          <CardTitle className="text-xl sm:text-2xl font-bold">
            <h1>{enrol ? t.mfa.enrollTitle : t.mfa.challengeTitle}</h1>
          </CardTitle>
          <CardDescription className="text-sm">{enrol ? t.mfa.enrollSubtitle : t.mfa.challengeSubtitle}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription className="text-sm" role="alert">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {preparing && (
            <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t.mfa.preparing}
            </p>
          )}

          {enrol && enrolment && (
            <div className="space-y-3 text-sm">
              <p>{t.mfa.enrollStep1}</p>
              {/* Supabase returns the QR code as an SVG data URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enrolment.qr} alt={t.mfa.qrAlt} width={192} height={192} className="mx-auto rounded-md border bg-white p-2" />
              <p>{t.mfa.enrollStep2}</p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md border bg-muted px-2 py-1.5 font-mono text-xs select-all">
                  {enrolment.secret}
                </code>
                <Button type="button" size="sm" variant="outline" onClick={() => void copySecret()} aria-label={t.mfa.copySecret}>
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  <span aria-live="polite">{copied ? t.mfa.copied : t.mfa.copySecret}</span>
                </Button>
              </div>
              <p>{t.mfa.enrollStep3}</p>
            </div>
          )}

          {factorId && (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="mfa-code" className="text-sm">
                  {t.mfa.code}
                </Label>
                <Input
                  id="mfa-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoFocus
                  disabled={busy}
                  className="text-base tracking-widest"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
                {busy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    {t.mfa.verifying}
                  </>
                ) : (
                  t.mfa.verify
                )}
              </Button>
            </form>
          )}

          <Button type="button" variant="ghost" size="sm" className="w-full" onClick={() => void signOut()}>
            {t.mfa.signOut}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

function errorReason(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as { code?: unknown; message?: unknown }
    if (typeof o.code === "string" && o.code) return o.code
    if (typeof o.message === "string" && o.message) return o.message
  }
  return "error"
}
