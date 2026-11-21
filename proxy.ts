import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { checkJsonBody, checkOrigin, expectedOriginFor } from "@/lib/csrf"
import { API_CSP, buildCsp, makeNonce } from "@/lib/csp"
import { MFA_CHALLENGE_PATH, MFA_ENROLL_PATH, redirectPathFor, resolveOperator } from "@/lib/operator-status"

/**
 * Operator console proxy (Next.js 16 replacement for middleware.ts).
 *
 * 1. CSRF, on every request (pages, API routes, server actions): a non-GET/
 *    HEAD/OPTIONS request must come from this console's own origin
 *    (403 bad_origin), and API bodies must be application/json
 *    (415 unsupported_media_type). See lib/csrf.ts.
 * 2. A per-request CSP nonce (lib/csp.ts); the other security headers are
 *    static, in next.config.mjs.
 * 3. Page convenience redirects — never the guard. Non-operators go to
 *    /login, operators without a second factor to /mfa/enroll or
 *    /mfa/challenge. Every page re-checks with lookupOperator(), and every API
 *    route handler checks itself via requireOperator() (401 unauthenticated /
 *    403 not_operator / 403 mfa_required); API routes are never redirected.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isApi = pathname === "/api" || pathname.startsWith("/api/")
  const isDev = process.env.NODE_ENV === "development"

  const origin = checkOrigin({
    method: request.method,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    expectedOrigin: expectedOriginFor(request.nextUrl.origin, process.env.CONSOLE_ORIGIN),
  })
  if (!origin.ok) {
    // No personal data: method, path and the reason only.
    console.warn(JSON.stringify({ event: "csrf_refused", reason: origin.reason, method: request.method, path: pathname }))
    return withApiHeaders(NextResponse.json({ error: "bad_origin" }, { status: 403 }))
  }
  if (
    isApi &&
    !checkJsonBody({
      method: request.method,
      contentType: request.headers.get("content-type"),
      contentLength: request.headers.get("content-length"),
      transferEncoding: request.headers.get("transfer-encoding"),
    })
  ) {
    return withApiHeaders(NextResponse.json({ error: "unsupported_media_type" }, { status: 415 }))
  }

  const nonce = makeNonce()
  const csp = isApi ? API_CSP : buildCsp({ nonce, isDev, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL })

  // Forward the (possibly refreshed) cookies and the CSP to the render, so
  // Next stamps the nonce on its scripts.
  const next = () => {
    const headers = new Headers(request.headers)
    if (!isApi) {
      headers.set("x-nonce", nonce)
      headers.set("content-security-policy", csp)
    }
    return NextResponse.next({ request: { headers } })
  }
  const finish = (res: NextResponse) => {
    res.headers.set("content-security-policy", csp)
    return res
  }

  let supabaseResponse = next()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // If environment variables are not available, skip the session part.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[superadmin] Supabase environment variables not found in proxy")
    return finish(supabaseResponse)
  }

  // API routes enforce their own operator check — never redirect them.
  if (isApi) return finish(supabaseResponse)

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = next()
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
      },
    },
  })

  // Refreshes the session if expired.
  const result = await resolveOperator(supabase)

  const redirect = (to: string) => {
    const res = NextResponse.redirect(new URL(to, request.url))
    // Keep refreshed session cookies on the redirect too.
    for (const c of supabaseResponse.cookies.getAll()) res.cookies.set(c)
    return finish(res)
  }

  const isLogin = pathname === "/login"
  const isMfa = pathname === MFA_ENROLL_PATH || pathname === MFA_CHALLENGE_PATH

  if (result.status === "operator") {
    return isLogin || isMfa ? redirect("/") : finish(supabaseResponse)
  }
  if (result.status === "mfa_required") {
    // The MFA pages pick enrol vs challenge themselves.
    return isMfa ? finish(supabaseResponse) : redirect(redirectPathFor(result))
  }
  if (isLogin) return finish(supabaseResponse)
  return redirect("/login")
}

function withApiHeaders(res: NextResponse) {
  res.headers.set("content-security-policy", API_CSP)
  return res
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
