import { describe, expect, it } from "vitest"
import { messages } from "@/lib/i18n/messages"
import { fmt, pickLang } from "@/lib/i18n/core"
import { apiError } from "@/lib/i18n/api-error"
import { issueText, libText, quoteText } from "@/components/superadmin/zones/zone-text"
import { ADMIN_NAV_ITEMS } from "@/lib/admin-nav"

type Tree = { [k: string]: string | ((n: number) => string) | Tree }

/** "path.to.key" → value, for every leaf. */
function leaves(tree: Tree, prefix = ""): Map<string, Tree[string]> {
  const out = new Map<string, Tree[string]>()
  for (const [k, v] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === "object") for (const [p, x] of leaves(v as Tree, path)) out.set(p, x)
    else out.set(path, v)
  }
  return out
}

// Words that read the same in both languages.
const SAME_IN_BOTH = new Set(["Email", "Slug", "Password", "Marketplace", "lat, lng", "km → €", "Nome *", "Area"])

describe("console strings", () => {
  const en = leaves(messages.en as unknown as Tree)
  const it_ = leaves(messages.it as unknown as Tree)

  it("Italian and English have the same keys", () => {
    expect([...it_.keys()].sort()).toEqual([...en.keys()].sort())
  })

  it("no string is empty and plurals stay plurals", () => {
    for (const [path, v] of it_) {
      expect(typeof v, path).toBe(typeof en.get(path))
      if (typeof v === "string") expect(v.trim(), path).not.toBe("")
      if (typeof v === "function") expect(v(1), path).not.toBe(v(2))
    }
  })

  it("Italian isn't English left untranslated", () => {
    const leftovers = [...it_]
      .filter(([path, v]) => typeof v === "string" && v === en.get(path) && v.length > 12 && !SAME_IN_BOTH.has(v))
      .map(([path]) => path)
    expect(leftovers).toEqual([])
  })

  it("placeholders match between languages", () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const [path, v] of it_) {
      const e = en.get(path)
      if (typeof v === "string" && typeof e === "string") expect(names(v), path).toEqual(names(e))
    }
  })

  it("every admin panel section has a name in both languages", () => {
    for (const item of ADMIN_NAV_ITEMS) {
      expect(messages.en.sections.items[item.key], item.key).toBeTruthy()
      expect(messages.it.sections.items[item.key], item.key).toBeTruthy()
    }
  })
})

describe("language choice", () => {
  it("defaults to Italian", () => {
    expect(pickLang(undefined, undefined)).toBe("it")
    expect(pickLang(undefined, "de-DE,de;q=0.9")).toBe("it")
  })
  it("gives an English-first browser English", () => {
    expect(pickLang(undefined, "en-US,en;q=0.9,it;q=0.8")).toBe("en")
  })
  it("a saved choice wins", () => {
    expect(pickLang("it", "en-US")).toBe("it")
    expect(pickLang("en", "it-IT")).toBe("en")
    expect(pickLang("fr", "it-IT")).toBe("it")
  })
  it("fills placeholders and leaves unknown ones visible", () => {
    expect(fmt("{a} di {b}", { a: 2, b: 7 })).toBe("2 di 7")
    expect(fmt("{a} {missing}", { a: 1 })).toBe("1 {missing}")
  })
})

describe("API errors", () => {
  const t = messages.it
  it("uses the screen's own wording first", () => {
    expect(apiError(t, "last_owner", 409, { last_owner: t.staff.lastOwner })).toBe(t.staff.lastOwner)
  })
  it("maps session and access codes", () => {
    expect(apiError(t, "unauthenticated", 401)).toBe(t.common.unauthenticated)
    expect(apiError(t, undefined, 403)).toBe(t.common.notOperator)
  })
  it("keeps an unknown code so it can be reported", () => {
    expect(apiError(t, "slug_taken", 409)).toBe("slug_taken")
  })
  it("falls back to the status, or the network message", () => {
    expect(apiError(t, undefined, 500)).toContain("500")
    expect(apiError(t, undefined)).toBe(t.common.network)
  })
})

describe("zones texts", () => {
  const t = messages.it
  it("translates a database check by code and keeps its number", () => {
    const issue = { severity: "warning" as const, code: "origin_moved", message: "The center point moved 240 m from the live one.", ref: null }
    expect(issueText(t, issue)).toBe("Il centro si è spostato di 240 m rispetto a quello online.")
  })
  it("keeps the server's words for an unknown check", () => {
    const issue = { severity: "blocker" as const, code: "brand_new_check", message: "Something new.", ref: null }
    expect(issueText(t, issue)).toBe("Something new.")
  })
  it("translates library messages, including ones with a value", () => {
    expect(libText(t, "Set the center point first.")).toBe("Prima imposta il centro.")
    expect(libText(t, "Invalid field: rings")).toBe("Campo non valido: rings")
    expect(libText(t, 'Unknown format "v9".')).toBe('Formato sconosciuto "v9".')
  })
  it("describes quotes for people", () => {
    expect(quoteText(t, null)).toBe("—")
    expect(quoteText(t, { status: "outside_area" } as never)).toBe("fuori dall'area")
  })
})
