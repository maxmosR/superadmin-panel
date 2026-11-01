"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase"
import { operatorCheckFromStatus } from "@/lib/operator-check"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2, ShieldCheck } from "lucide-react"
import { LanguageSwitch, useI18n } from "@/lib/i18n/client"

export default function SuperAdminLoginPage() {
  const { t } = useI18n()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setError(error.message)
        return
      }
      if (!data.user) {
        setError(t.login.failed)
        return
      }

      // Confirm this account is actually a platform admin:
      // 401 unauthenticated / 403 not_operator both mean "not an operator".
      // Any other non-OK status means we couldn't verify: never treat it as success.
      const res = await fetch("/api/me", { method: "GET" })
      const check = operatorCheckFromStatus(res.status)
      if (check !== "operator") {
        await supabase.auth.signOut()
        setError(check === "not_operator" ? t.login.notOperator : t.login.couldNotVerify)
        return
      }

      router.push("/")
      router.refresh()
    } catch {
      setError(t.login.unexpected)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background p-4 sm:p-6">
      <LanguageSwitch className="absolute top-4 right-4" />
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl sm:text-2xl font-bold">
            <h1>{t.login.title}</h1>
          </CardTitle>
          <CardDescription className="text-sm">{t.login.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription className="text-sm">{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm">
                {t.login.email}
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
                disabled={loading}
                className="text-base"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm">
                {t.login.password}
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t.login.passwordPlaceholder}
                required
                disabled={loading}
                className="text-base"
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t.login.signingIn}
                </>
              ) : (
                t.login.signIn
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
