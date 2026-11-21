// Order-receiver device pairing helpers shared by the route and the UI.

export interface OrderDevice {
  id: string
  label: string | null
  created_at: string
  last_seen_at: string | null
  revoked_at: string | null
}

/** The pairing RPC's 10-character code, shown grouped as XXXXX-XXXXX. */
export function groupPairingCode(code: string): string {
  const c = code.replace(/[^0-9A-Z]/gi, "").toUpperCase()
  return c.length === 10 ? `${c.slice(0, 5)}-${c.slice(5)}` : code
}
