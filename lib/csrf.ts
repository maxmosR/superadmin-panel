// Cross-site request forgery checks, run by proxy.ts on every request.
// Pure functions (no Next or Supabase imports) so they are unit-tested.
//
// The console's session is a cookie, so any state-changing request (API route
// or server action) must prove it comes from a page of this console:
// - `Origin` must equal the console's own origin, exactly (scheme, host and
//   port). A sibling *.birraora.app restaurant or admin host is cross-origin
//   and is refused, even though the browser calls it "same-site".
// - With no `Origin` (rare: some older browsers on same-origin requests), the
//   Fetch Metadata header `Sec-Fetch-Site` must be `same-origin`. Neither
//   header present → refused.
// - JSON API bodies must be sent as application/json. A cross-site <form> or
//   `fetch(..., { mode: "no-cors" })` can only send text/plain, urlencoded or
//   multipart without a preflight, so refusing those closes the "text/plain
//   JSON" trick even if an Origin check were ever bypassed.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase())
}

/** Normalised origin of a URL-ish string, or null when it isn't one ("null", garbage). */
function originOf(value: string): string | null {
  try {
    const u = new URL(value)
    if (u.protocol !== "https:" && u.protocol !== "http:") return null
    return u.origin
  } catch {
    return null
  }
}

export type OriginCheck = { ok: true } | { ok: false; reason: "missing" | "mismatch" }

/**
 * Is this request allowed to change state?
 * `expectedOrigin` is the console's own origin (e.g. https://superadmin.birraora.app).
 */
export function checkOrigin(input: {
  method: string
  origin: string | null
  secFetchSite: string | null
  expectedOrigin: string
}): OriginCheck {
  if (isSafeMethod(input.method)) return { ok: true }
  const expected = originOf(input.expectedOrigin)
  if (!expected) return { ok: false, reason: "mismatch" }
  if (input.origin !== null && input.origin !== "") {
    // Browsers send the serialized origin, so this is an exact string match.
    return input.origin === expected ? { ok: true } : { ok: false, reason: "mismatch" }
  }
  if ((input.secFetchSite ?? "").toLowerCase() === "same-origin") return { ok: true }
  return { ok: false, reason: "missing" }
}

/** application/json, optionally with parameters (charset). Nothing else, not even +json types. */
export function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const type = contentType.split(";")[0].trim().toLowerCase()
  return type === "application/json"
}

/**
 * API routes take JSON bodies only. A state-changing request that carries a
 * body (or declares a content type) must declare application/json; a
 * body-less DELETE with query parameters is fine.
 */
export function checkJsonBody(input: {
  method: string
  contentType: string | null
  contentLength: string | null
  transferEncoding: string | null
}): boolean {
  if (isSafeMethod(input.method)) return true
  const hasBody = (input.contentLength !== null && input.contentLength !== "0") || input.transferEncoding !== null
  if (!hasBody && !input.contentType) return true
  return isJsonContentType(input.contentType)
}

/**
 * The console's own origin. CONSOLE_ORIGIN (e.g. https://superadmin.birraora.app)
 * pins it in production; otherwise it is the origin the request was addressed
 * to, which a victim's browser sets from the URL it actually loaded.
 */
export function expectedOriginFor(requestOrigin: string, configured: string | undefined): string {
  const pinned = configured?.trim()
  return pinned ? (originOf(pinned) ?? pinned) : requestOrigin
}
