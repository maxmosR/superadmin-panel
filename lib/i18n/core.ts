// Language basics shared by server and browser code. The console speaks
// Italian (the default) and English, like every BirraOra surface.

export const LANGS = ["it", "en"] as const
export type Lang = (typeof LANGS)[number]

/** Cookie holding the operator's choice; readable on the server so the first render is already right. */
export const LANG_COOKIE = "console_lang"

export function isLang(v: unknown): v is Lang {
  return typeof v === "string" && (LANGS as readonly string[]).includes(v)
}

/** A saved choice wins; else an English-first browser gets English; else Italian. */
export function pickLang(saved: string | undefined | null, acceptLanguage: string | undefined | null): Lang {
  if (isLang(saved)) return saved
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().slice(0, 2).toLowerCase()
  return first === "en" ? "en" : "it"
}

/** Locale for Intl formatting. English uses en-GB: day-month dates, 24-hour clock. */
export function localeOf(lang: Lang) {
  return lang === "it" ? "it-IT" : "en-GB"
}

/** Fills {name} placeholders. Unknown names stay as written so a gap is visible. */
export function fmt(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}
