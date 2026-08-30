/**
 * Domain helpers shared by the businesses + domains API routes.
 *
 * A business may own MANY domains. Each row in `business_domains` is either:
 *   - a bare subdomain label ("acme"), resolved as "<label>.<ROOT_DOMAIN>", or
 *   - a full hostname ("shop.acme.com"), matched verbatim against the request.
 *
 * `resolve_business_id_by_host()` in Postgres matches, in order: the exact
 * hostname, the hostname without "www.", then the left-most label — so both
 * shapes work without the app having to know which is which.
 */

// One DNS label: lowercase alphanumerics + hyphens, not starting/ending with one.
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
// A full hostname: two or more labels, last one alphabetic (the TLD).
const HOSTNAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Labels that may never be claimed as a bare subdomain by a tenant. */
export const RESERVED_LABELS = new Set(["superadmin", "www", "app", "api", "admin", "localhost"])

export type DomainKind = "label" | "hostname"

/**
 * Normalize user input into a storable domain value: lowercased, with any
 * scheme, port, path, and trailing dot stripped. Returns null when the result
 * is neither a valid bare label nor a valid hostname, or when a bare label is
 * reserved.
 */
export function normalizeDomain(raw: unknown): string | null {
  if (typeof raw !== "string") return null

  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "") // scheme
    .replace(/[:/?#].*$/, "") // port, path, query, fragment
    .replace(/\.$/, "") // trailing root dot

  if (!cleaned) return null

  if (cleaned.includes(".")) {
    return HOSTNAME_RE.test(cleaned) ? cleaned : null
  }

  if (!LABEL_RE.test(cleaned) || RESERVED_LABELS.has(cleaned)) return null
  return cleaned
}

export function domainKind(domain: string): DomainKind {
  return domain.includes(".") ? "hostname" : "label"
}

/**
 * The URL a tenant is reached at. Bare labels are rendered against the
 * configured root domain; full hostnames stand on their own.
 */
export function domainDisplayHost(domain: string, rootDomain: string): string {
  return domainKind(domain) === "label" ? `${domain}.${rootDomain}` : domain
}
