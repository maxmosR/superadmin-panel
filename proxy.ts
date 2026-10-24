import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

/**
 * Super Admin panel proxy (Next.js 16 replacement for middleware.ts).
 *
 * Convenience only — never the guard. It refreshes the session and redirects
 * non-operators on page routes to /login. Every page re-checks the operator
 * server-side, and every API route handler checks it itself via
 * requireOperator() (401 unauthenticated / 403 not_operator); API routes are
 * never redirected here.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // If environment variables are not available, skip the proxy.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error("[superadmin] Supabase environment variables not found in proxy")
    return supabaseResponse
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
      },
    },
  })

  const { pathname } = request.nextUrl

  // API routes enforce their own admin check — never redirect them.
  if (pathname.startsWith("/api")) {
    return supabaseResponse
  }

  // Refresh session if expired.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let isAdmin = false
  if (user) {
    const { data } = await supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle()
    isAdmin = !!data
  }

  const isLoginRoute = pathname === "/login"

  if (isLoginRoute) {
    if (isAdmin) return NextResponse.redirect(new URL("/", request.url))
    return supabaseResponse
  }

  if (!isAdmin) return NextResponse.redirect(new URL("/login", request.url))

  return supabaseResponse
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
