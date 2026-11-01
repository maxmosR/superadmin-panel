"use client"

import type React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LogOut, ShieldCheck } from "lucide-react"
import { createClient } from "@/lib/supabase"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { LanguageSwitch, useI18n } from "@/lib/i18n/client"

const NAV = [
  { href: "/", key: "restaurants" },
  { href: "/operators", key: "operators" },
  { href: "/features", key: "sections" },
  { href: "/providers", key: "providers" },
] as const

// The frame every console page shares: product name, section nav, the
// signed-in operator and sign out. The zones editor keeps its own full-screen
// header and doesn't use this.
export function ConsoleShell({
  adminEmail,
  width = "default",
  children,
}: {
  adminEmail: string | null
  width?: "narrow" | "default"
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useI18n()

  const signOut = async () => {
    await createClient().auth.signOut()
    router.push("/login")
    router.refresh()
  }

  // A restaurant's own pages (/businesses/…) belong under Restaurants.
  const isActive = (href: string) => (href === "/" ? pathname === "/" || pathname.startsWith("/businesses/") : pathname.startsWith(href))
  // One width on every page so the header never moves; narrow pages
  // left-align under it, wide tables scroll inside their own card.
  const container = "max-w-6xl"

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className={cn("mx-auto flex flex-wrap items-center gap-x-6 gap-y-2 px-4 pt-3 sm:px-6 md:pb-0", container)}>
          <Link href="/" className="flex items-center gap-2 rounded-md py-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
            <span className="font-semibold">{t.shell.brand}</span>
          </Link>

          <div className="ml-auto flex items-center gap-3 md:order-last">
            {adminEmail && <span className="hidden text-sm text-muted-foreground lg:inline">{adminEmail}</span>}
            <LanguageSwitch />
            <Button variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOut className="h-4 w-4" aria-hidden />
              {t.shell.signOut}
            </Button>
          </div>

          {/* Full row under the brand on phones, inline from md. */}
          <nav aria-label={t.shell.nav.label} className="-mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:w-auto md:px-0">
            <ul className="flex gap-1">
              {NAV.map((item) => {
                const active = isActive(item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative inline-flex h-11 items-center whitespace-nowrap rounded-t-md px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        active
                          ? "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t.shell.nav[item.key]}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        </div>
      </header>

      <main className={cn("mx-auto px-4 py-6 sm:px-6", container)}>
        {width === "narrow" ? <div className="max-w-3xl">{children}</div> : children}
      </main>
    </div>
  )
}

/** Page title, one-line description and the page's primary action. */
export function PageHead({
  title,
  description,
  action,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
