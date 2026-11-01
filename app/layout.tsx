import type React from "react"
import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { I18nProvider } from "@/lib/i18n/client"
import { getLang } from "@/lib/i18n/server"
import { UndoToastProvider } from "@/components/superadmin/undo-toast"
import "./globals.css"

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang()
  return lang === "it"
    ? {
        title: { default: "Console operatori · BirraOra", template: "%s · BirraOra" },
        description: "Configura ristoranti, titolari, domini e zone di consegna.",
      }
    : {
        title: { default: "Operator console · BirraOra", template: "%s · BirraOra" },
        description: "Set up restaurants, owners, domains and delivery zones.",
      }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Italian by default; the operator's choice is a cookie, so the first render is already in it.
  const lang = await getLang()
  return (
    <html lang={lang} className="light">
      <body className={`font-sans ${GeistSans.variable} ${GeistMono.variable}`}>
        <I18nProvider initial={lang}>
          <UndoToastProvider>{children}</UndoToastProvider>
        </I18nProvider>
      </body>
    </html>
  )
}
