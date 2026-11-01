"use client"

import Link from "next/link"
import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n/client"

// Last resort for an error a page didn't handle: say so plainly and offer a
// way back, instead of a blank screen.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t, fmt } = useI18n()
  useEffect(() => {
    // The digest links to the server log; no personal data here.
    console.error("page failed", error.digest ?? error.name)
  }, [error])

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
      <h1 className="text-2xl font-bold">{t.shell.pageError.title}</h1>
      <p className="text-sm text-muted-foreground">
        {t.shell.pageError.body}
        {error.digest && <span className="mt-2 block font-mono text-xs">{fmt(t.shell.pageError.reference, { id: error.digest })}</span>}
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>{t.common.tryAgain}</Button>
        <Button variant="outline" asChild>
          <Link href="/">{t.shell.nav.restaurants}</Link>
        </Button>
      </div>
    </main>
  )
}
