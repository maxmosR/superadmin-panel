// Content-Security-Policy for the console, built per request by proxy.ts.
//
// Nonce-based scripts, not 'unsafe-inline': every console page is rendered per
// request (the root layout reads the language cookie and every page exports
// `dynamic = "force-dynamic"`), which is what Next 16 needs to stamp a nonce
// on its own bootstrap/flight scripts (docs: guides/content-security-policy).
// With 'strict-dynamic', scripts those nonced scripts add are trusted too: the
// Google Maps loader (lib/google-maps/loader.ts) appends its <script> tag from
// a bundle, and Maps loads its own modules the same way. An injected
// <script> or inline handler has no nonce and does not run.
//
// Styles keep 'unsafe-inline': React `style={…}` attributes, Radix popovers
// and Google Maps all set inline styles, which a nonce cannot cover. CSS
// injection is a much smaller risk than script injection.
//
// Third parties the browser really talks to:
// - Supabase (NEXT_PUBLIC_SUPABASE_URL): Auth (sign-in, MFA enrol/verify,
//   sign-out) from the browser client; https + wss (Realtime is not used, but
//   supabase-js may open it lazily).
// - Google Maps JS + Places (zones editor): *.googleapis.com, *.gstatic.com,
//   tiles/photos on *.google.com / *.googleusercontent.com, Roboto from
//   fonts.googleapis.com / fonts.gstatic.com, blob: workers.
// - Fonts: geist is self-hosted by next/font. MFA QR codes are data: SVGs.
// Edge Functions (payout, SMS) are called server-side, not from the browser.

export function supabaseOrigins(url: string | undefined): string[] {
  if (!url) return []
  try {
    const u = new URL(url)
    return [u.origin, `${u.protocol === "http:" ? "ws" : "wss"}://${u.host}`]
  } catch {
    return []
  }
}

/** A fresh, unguessable nonce (128 bits, base64). */
export function makeNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let s = ""
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

export function buildCsp(opts: { nonce: string; isDev: boolean; supabaseUrl: string | undefined }): string {
  const { nonce, isDev } = opts
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // React needs eval only in development (error-stack reconstruction).
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https://*.googleapis.com",
      "https://*.gstatic.com",
      "https://*.google.com",
      "https://*.googleusercontent.com",
    ],
    "font-src": ["'self'", "https://fonts.gstatic.com"],
    "connect-src": [
      "'self'",
      ...supabaseOrigins(opts.supabaseUrl),
      "https://*.googleapis.com",
      "https://*.google.com",
      "https://*.gstatic.com",
      "data:",
      "blob:",
      ...(isDev ? ["ws:"] : []),
    ],
    "frame-src": ["https://*.google.com"],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  }
  const value = Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ")
  return isDev ? value : `${value}; upgrade-insecure-requests`
}

/** API responses are JSON, never rendered: nothing may load, nobody may frame. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
