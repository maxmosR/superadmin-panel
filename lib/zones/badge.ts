import type { ZonesBadge } from "./types"

export interface ZoneSetRow {
  business_id: string
  status: string
  version: number
  based_on_version: number | null
  created_at: string
  updated_at: string
}

/**
 * Dashboard badge per restaurant, from its draft and published set rows.
 * A draft has unpublished changes when nothing is published, when it was
 * restored from another version, or when it was saved after being created
 * (creating a draft and building it happen in one transaction, so its
 * created_at and updated_at are equal until the first save).
 */
export function zoneBadges(rows: ZoneSetRow[]): Map<string, ZonesBadge> {
  const byBiz = new Map<string, { draft?: ZoneSetRow; published?: ZoneSetRow }>()
  for (const r of rows) {
    const e = byBiz.get(r.business_id) ?? {}
    if (r.status === "draft") e.draft = r
    else if (r.status === "published") e.published = r
    byBiz.set(r.business_id, e)
  }
  const out = new Map<string, ZonesBadge>()
  for (const [id, { draft, published }] of byBiz) {
    out.set(id, {
      published_version: published?.version ?? null,
      has_draft_changes:
        !!draft &&
        (!published ||
          draft.based_on_version !== published.version ||
          new Date(draft.updated_at).getTime() !== new Date(draft.created_at).getTime()),
    })
  }
  return out
}

export const NO_ZONES: ZonesBadge = { published_version: null, has_draft_changes: false }
