// Shapes shared by the zone API routes and the editor. The database is the
// source of truth (supabase/migrations/20261026130000_delivery_zones.sql in
// the storefront repo); these mirror what its functions take and return.

export type LatLng = { lat: number; lng: number }

export type RuleMode = "ring_fee" | "custom_fee" | "excluded"

export interface RingInput {
  radius_m: number
  fee: number
  label: string | null
}

export interface CutLineInput {
  id: string | null
  label: string | null
  points: LatLng[]
}

export interface RuleInput {
  id: string | null
  anchor: LatLng
  mode: RuleMode
  fee: number | null
  label: string | null
}

/** Body of save_delivery_zone_draft (and of an exported JSON file). */
export interface DraftPayload {
  origin: LatLng
  rings: RingInput[]
  cut_lines: CutLineInput[]
  rules: RuleInput[]
}

export type IssueRef = { kind: "ring" | "line" | "rule" | "piece"; id: string }

export interface ZoneIssue {
  severity: "blocker" | "warning"
  code: string
  message: string
  ref: IssueRef | null
}

export interface PieceProperties {
  id: string
  ring_index: number
  radius_m: number
  fee: number
  deliverable: boolean
  rule_id: string | null
  label: string | null
  area_m2: number
  /** [lng, lat] */
  label_point: [number, number]
}

export interface PieceFeature {
  type: "Feature"
  id: string
  geometry: { type: "Polygon"; coordinates: number[][][] }
  properties: PieceProperties
}

export interface PieceCollection {
  type: "FeatureCollection"
  features: PieceFeature[]
}

export interface ExtendedLine {
  id: string
  geometry: { type: "LineString" | "MultiLineString" | "GeometryCollection"; coordinates?: unknown }
}

/** get_delivery_zone_set_geojson: one set, authored state + computed pieces. */
export interface ZoneSetView {
  set_id: string
  version: number
  status: "draft" | "published" | "archived"
  revision: number
  based_on_version: number | null
  published_at: string | null
  published_by: string | null
  updated_at: string
  origin: LatLng
  rings: Array<RingInput & { id: string }>
  cut_lines: Array<CutLineInput & { id: string }>
  rules: Array<RuleInput & { id: string; last_ring_radius_m: number | null; last_piece_area_m2: number | null }>
  pieces: PieceCollection
  issues: ZoneIssue[]
  extended_lines: ExtendedLine[]
}

/** save_delivery_zone_draft's answer. */
export interface SaveResult {
  revision: number
  pieces: PieceCollection
  issues: ZoneIssue[]
  extended_lines: ExtendedLine[]
}

export type QuoteStatus = "ok" | "outside_area" | "excluded_area" | "no_zones"

/** One row of quote_delivery / test_delivery_address. */
export interface QuoteResult {
  status: QuoteStatus
  zone_id: string | null
  zone_set_id: string | null
  zone_version: number | null
  fee: number | null
  fee_cents: number | null
  deliverable: boolean
  ring_index: number | null
  radius_m: number | null
  label: string | null
  distance_m: number | null
}

export interface ZoneVersionRow {
  version: number
  status: "published" | "archived"
  published_at: string | null
  published_by: string | null
  published_by_email: string | null
}

export interface ZonesBadge {
  published_version: number | null
  has_draft_changes: boolean
}

export interface ZonesBusiness {
  business_id: string
  business_name: string
  slug: string
  address: string | null
  latitude: number | null
  longitude: number | null
}

/** GET /api/zones */
export interface ZonesOverview {
  business: ZonesBusiness
  draft: ZoneSetView | null
  published: ZoneSetView | null
  versions: ZoneVersionRow[]
  zones: ZonesBadge
}

/** Limits, matching delivery_zone_thresholds() in the database. */
export const ZONE_LIMITS = {
  maxRings: 10,
  maxLines: 30,
  maxRules: 100,
  maxPoints: 50,
  minRadiusM: 100,
  maxRadiusM: 50_000,
  maxFee: 999.99,
  maxLabel: 80,
  /** Center moves beyond this ask for confirmation (and warn at publish). */
  originMovedM: 200,
} as const
