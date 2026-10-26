/**
 * The restaurant admin panel's sidebar sections, as the operator toggles them
 * per restaurant on /features (`business_admin_nav.hidden_items`).
 *
 * Keep the keys and their order in sync with ../admin-panel-shop/lib/admin-nav.ts,
 * which turns a hidden key into: no sidebar entry, 404 for its pages (its code
 * is never sent to that restaurant's browsers) and 403 for its API routes.
 */

export const ADMIN_NAV_ITEMS = [
  { key: "orders", label: "Orders" },
  { key: "products", label: "Products" },
  { key: "categories", label: "Categories/Ingredients" },
  { key: "couriers", label: "Couriers" },
  { key: "business", label: "Business" },
  { key: "providers", label: "Providers" },
  { key: "team", label: "Team" },
  { key: "offers", label: "Offers" },
  { key: "printLabels", label: "Print Labels" },
  { key: "scan", label: "Scan" },
  { key: "traceInvoices", label: "Trace Invoices" },
  { key: "expensesVsProfit", label: "Expenses vs Profit" },
  { key: "notTraceable", label: "Not Traceable" },
  { key: "createOrder", label: "Create Order" },
] as const

export type AdminNavKey = (typeof ADMIN_NAV_ITEMS)[number]["key"]

export const ADMIN_NAV_KEYS: readonly AdminNavKey[] = ADMIN_NAV_ITEMS.map((i) => i.key)

/**
 * Validate a hidden-items list from a request body. Returns the keys in the
 * canonical order, without duplicates, or throws a readable message.
 */
export function parseHiddenItems(value: unknown): AdminNavKey[] {
  if (!Array.isArray(value)) throw new Error("hidden_items must be an array")
  const unknown = value.filter((v) => typeof v !== "string" || !(ADMIN_NAV_KEYS as readonly string[]).includes(v))
  if (unknown.length) throw new Error(`Unknown section: ${unknown.map(String).join(", ")}`)
  return ADMIN_NAV_KEYS.filter((k) => value.includes(k))
}
