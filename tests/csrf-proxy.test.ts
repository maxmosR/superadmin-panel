import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { checkJsonBody, checkOrigin, expectedOriginFor, isJsonContentType } from "@/lib/csrf"
import { buildCsp } from "@/lib/csp"

// The page branch of the proxy resolves the operator through @supabase/ssr.
const auth = {
  user: null as { id: string; factors?: Array<{ factor_type: string; status: string }> } | null,
  token: null as string | null,
  admin: false,
}
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: auth.admin ? { user_id: auth.user?.id, email: null, is_active: true } : null, error: null }),
    }
    return {
      auth: {
        getUser: async () => ({ data: { user: auth.user }, error: null }),
        getSession: async () => ({ data: { session: auth.token ? { access_token: auth.token } : null }, error: null }),
      },
      from: () => q,
    }
  }),
}))

import { proxy } from "@/proxy"

const CONSOLE = "https://superadmin.birraora.app"

function req(method: string, path: string, headers: Record<string, string> = {}, body?: string) {
  return new NextRequest(`${CONSOLE}${path}`, { method, headers, body })
}

function token(claims: Record<string, unknown>) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url")
  return `${b64({ alg: "HS256" })}.${b64(claims)}.sig`
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://tmwccwjmdmqjhicbctvm.supabase.co")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon")
  vi.stubEnv("CONSOLE_ORIGIN", "")
  auth.user = null
  auth.token = null
  auth.admin = false
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("checkOrigin", () => {
  const base = { secFetchSite: null, expectedOrigin: CONSOLE }
  it.each(["GET", "HEAD", "OPTIONS"])("lets a %s through without any header", (method) => {
    expect(checkOrigin({ ...base, method, origin: null })).toEqual({ ok: true })
  })

  it("accepts the console's own origin exactly", () => {
    expect(checkOrigin({ ...base, method: "POST", origin: CONSOLE })).toEqual({ ok: true })
  })

  it.each([
    "https://hosuto.birraora.app", // sibling restaurant subdomain (same-site, not same-origin)
    "https://admin.birraora.app",
    "https://superadmin.birraora.app.evil.com",
    "http://superadmin.birraora.app", // scheme downgrade
    "https://superadmin.birraora.app:8443",
    "https://evil.com",
    "null",
  ])("refuses Origin %s", (origin) => {
    expect(checkOrigin({ ...base, method: "POST", origin })).toEqual({ ok: false, reason: "mismatch" })
  })

  it("falls back to Sec-Fetch-Site: same-origin only", () => {
    expect(checkOrigin({ ...base, method: "DELETE", origin: null, secFetchSite: "same-origin" })).toEqual({ ok: true })
    expect(checkOrigin({ ...base, method: "DELETE", origin: null, secFetchSite: "same-site" })).toEqual({ ok: false, reason: "missing" })
    expect(checkOrigin({ ...base, method: "DELETE", origin: null, secFetchSite: "cross-site" })).toEqual({ ok: false, reason: "missing" })
    expect(checkOrigin({ ...base, method: "PUT", origin: null, secFetchSite: null })).toEqual({ ok: false, reason: "missing" })
  })

  it("pins the origin from CONSOLE_ORIGIN when set", () => {
    expect(expectedOriginFor("http://internal:3000", "https://superadmin.birraora.app/")).toBe(CONSOLE)
    expect(expectedOriginFor("http://localhost:3000", undefined)).toBe("http://localhost:3000")
  })
})

describe("JSON bodies", () => {
  it("accepts application/json with or without charset", () => {
    expect(isJsonContentType("application/json")).toBe(true)
    expect(isJsonContentType("Application/JSON; charset=utf-8")).toBe(true)
  })

  it.each(["text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/merge-patch+json", null])(
    "refuses %s for a body",
    (contentType) => {
      expect(checkJsonBody({ method: "POST", contentType, contentLength: "12", transferEncoding: null })).toBe(false)
    },
  )

  it("allows a body-less DELETE with query parameters", () => {
    expect(checkJsonBody({ method: "DELETE", contentType: null, contentLength: null, transferEncoding: null })).toBe(true)
  })
})

describe("proxy CSRF", () => {
  const json = { "content-type": "application/json" }

  it("passes a same-origin JSON API call through", async () => {
    const res = await proxy(req("PUT", "/api/businesses/staff-email", { ...json, origin: CONSOLE }, "{}"))
    expect(res.status).toBe(200)
    expect(res.headers.get("x-middleware-next")).toBe("1")
  })

  it("refuses a sibling *.birraora.app origin with 403 bad_origin", async () => {
    const res = await proxy(req("PUT", "/api/businesses/staff-email", { ...json, origin: "https://hosuto.birraora.app" }, "{}"))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "bad_origin" })
  })

  it("refuses a request with neither Origin nor Sec-Fetch-Site", async () => {
    const res = await proxy(req("POST", "/api/operators", json, "{}"))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "bad_origin" })
  })

  it("accepts Sec-Fetch-Site: same-origin when Origin is absent", async () => {
    const res = await proxy(req("POST", "/api/zones/test", { ...json, "sec-fetch-site": "same-origin" }, "{}"))
    expect(res.status).toBe(200)
  })

  it("refuses the text/plain JSON trick with 415", async () => {
    const res = await proxy(req("POST", "/api/operators", { "content-type": "text/plain", origin: CONSOLE }, '{"user_id":"x"}'))
    expect(res.status).toBe(415)
    expect(await res.json()).toEqual({ error: "unsupported_media_type" })
  })

  it("refuses a cross-origin server action POST to a page", async () => {
    const res = await proxy(req("POST", "/operators", { origin: "https://evil.com", "next-action": "abc", "content-type": "text/plain" }, "[]"))
    expect(res.status).toBe(403)
  })

  it("lets cross-origin GETs through (they change nothing)", async () => {
    const res = await proxy(req("GET", "/api/me", { origin: "https://evil.com" }))
    expect(res.status).toBe(200)
  })
})

describe("proxy page redirects and CSP", () => {
  it("sends an AAL1 operator without TOTP to enrolment, and with TOTP to the challenge", async () => {
    auth.admin = true
    auth.user = { id: "u1", factors: [] }
    auth.token = token({ sub: "u1", aal: "aal1" })
    let res = await proxy(req("GET", "/"))
    expect(res.headers.get("location")).toBe(`${CONSOLE}/mfa/enroll`)

    auth.user = { id: "u1", factors: [{ factor_type: "totp", status: "verified" }] }
    res = await proxy(req("GET", "/operators"))
    expect(res.headers.get("location")).toBe(`${CONSOLE}/mfa/challenge`)

    // The MFA pages themselves are reachable at AAL1.
    res = await proxy(req("GET", "/mfa/challenge"))
    expect(res.headers.get("location")).toBeNull()
  })

  it("lets an AAL2 operator in and moves them off the MFA pages", async () => {
    auth.admin = true
    auth.user = { id: "u1", factors: [{ factor_type: "totp", status: "verified" }] }
    auth.token = token({ sub: "u1", aal: "aal2" })
    expect((await proxy(req("GET", "/operators"))).headers.get("location")).toBeNull()
    expect((await proxy(req("GET", "/mfa/enroll"))).headers.get("location")).toBe(`${CONSOLE}/`)
  })

  it("sends a non-operator to /login, even from the MFA pages", async () => {
    auth.user = { id: "u2" }
    expect((await proxy(req("GET", "/mfa/enroll"))).headers.get("location")).toBe(`${CONSOLE}/login`)
  })

  it("puts a fresh nonce CSP on pages, forwarded to the render", async () => {
    const a = await proxy(req("GET", "/login"))
    const b = await proxy(req("GET", "/login"))
    const csp = a.headers.get("content-security-policy") ?? ""
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/)
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toContain("'unsafe-inline' 'strict-dynamic'")
    expect(csp).toContain("https://tmwccwjmdmqjhicbctvm.supabase.co")
    expect(csp).not.toBe(b.headers.get("content-security-policy"))
    // Next reads the nonce from the forwarded request header.
    expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(csp)
  })

  it("puts a locked-down CSP on API responses", async () => {
    const res = await proxy(req("GET", "/api/me"))
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'")
  })
})

describe("buildCsp", () => {
  it("allows eval only in development", () => {
    expect(buildCsp({ nonce: "n", isDev: true, supabaseUrl: undefined })).toContain("'unsafe-eval'")
    const prod = buildCsp({ nonce: "n", isDev: false, supabaseUrl: undefined })
    expect(prod).not.toContain("'unsafe-eval'")
    expect(prod).toContain("upgrade-insecure-requests")
  })
})
