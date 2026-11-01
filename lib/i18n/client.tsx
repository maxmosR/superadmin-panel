"use client"

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { fmt, LANG_COOKIE, localeOf, type Lang } from "./core"
import { messages, type Messages } from "./messages"

interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  /** The strings for the current language. */
  t: Messages
  /** Fills {name} placeholders. */
  fmt: typeof fmt
  /** Intl locale for dates and numbers. */
  locale: string
}

const I18nContext = createContext<I18n | null>(null)

/** `initial` comes from the server (cookie or browser language), so the first render matches. */
export function I18nProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial)
  const router = useRouter()

  const setLang = useCallback(
    (next: Lang) => {
      setLangState(next)
      document.documentElement.lang = next
      // A year; read by the server for <html lang> and the page title.
      document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`
      router.refresh()
    },
    [router],
  )

  const value = useMemo<I18n>(() => ({ lang, setLang, t: messages[lang], fmt, locale: localeOf(lang) }), [lang, setLang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider")
  return ctx
}

/** IT / EN switch. The current language is pressed. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n()
  return (
    <div role="group" aria-label={t.common.language} className={"inline-flex rounded-md border p-0.5 " + (className ?? "")}>
      {(["it", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={lang === l}
          aria-label={l === "it" ? "Italiano" : "English"}
          onClick={() => lang !== l && setLang(l)}
          className={
            "h-7 rounded-[5px] px-2 text-xs font-semibold uppercase outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 " +
            (lang === l ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")
          }
        >
          {l}
        </button>
      ))}
    </div>
  )
}
