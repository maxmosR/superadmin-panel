// Audit-before-mutation and stable error codes for the domain, subdomain,
// provider and admin-nav routes.
import { beforeEach, describe, expect, it, vi } from "vitest"

const OP = "00000000-0000-4000-8000-0000000000aa"
const BIZ = "00000000-0000-4000-8000-000000000001"
const PROVIDER = "00000000-0000-4000-8000-000000000002"

type Query = { table: string; op: string; columns?: string; head?: boolean; filters: Array<[string, unknown]>; values?: unknown }
type Result = { data?: unknown; error?: { code?: string; message?: string } | null; count?: number }

const db = vi.hoisted(() => ({
  log: [] as string[],
  audits: [] as Array<Record<string, unknown>>,
  auditError: null as null | { code: string; message: string },
  handler: (() => ({})) as (q: Query) => Result,
  rpcHandler: (() => ({ data: [], error: null })) as (fn: string, args: Record<string, unknown>) => Result,
}))

vi.mock("@/lib/require-operator", () => ({
  requireOperator: vi.fn(async () => ({ admin: { userId: OP, email: null } })),
}))

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      db.log.push(`rpc:${fn}`)
      if (fn === "record_audit") {
        db.audits.push(args)
        return db.auditError ? { data: null, error: db.auditError } : { data: "audit-1", error: null }
      }
      const r = db.rpcHandler(fn, args)
      return { data: r.data ?? null, error: r.error ?? null }
    },
    from: (table: string) => {
      const q: Query = { table, op: "select", filters: [] }
      const run = () => {
        if (q.op !== "select") db.log.push(`${q.op}:${table}`)
        const r = db.handler(q)
        return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null }
      }
      const b: Record<string, unknown> = {}
      b.select = (columns?: string, opts?: { head?: boolean }) => {
        if (q.op === "select") q.columns = columns
        q.head = !!opts?.head
        return b
      }
      for (const op of ["insert", "update", "upsert"]) {
        b[op] = (values: unknown) => {
          q.op = op
          q.values = values
          return b
        }
      }
      b.delete = () => {
        q.op = "delete"
        return b
      }
      for (const m of ["eq", "in", "is", "order"]) {
        b[m] = (c: string, v: unknown) => {
          q.filters.push([c, v])
          return b
        }
      }
      b.maybeSingle = async () => run()
      b.single = async () => run()
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko)
      return b
    },
  }),
}))

import * as domains from "@/app/api/businesses/domains/route"
import * as businesses from "@/app/api/businesses/route"
import * as providers from "@/app/api/providers/route"
import * as businessProviders from "@/app/api/businesses/providers/route"
import * as adminNav from "@/app/api/admin-nav/route"

const json = (method: string, url: string, body: unknown) =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

const has = (q: Query, col: string) => q.filters.some(([c]) => c === col)
const SECRET = "relation \"business_domains\" violates policy at server.internal:5432"

beforeEach(() => {
  db.log = []
  db.audits = []
  db.auditError = null
  db.handler = () => ({})
  db.rpcHandler = () => ({ data: [], error: null })
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "info").mockImplementation(() => {})
})

const auditFails = () => {
  db.auditError = { code: "22P02", message: "invalid input value for enum" }
}
const mutations = () => db.log.filter((l) => /^(insert|update|upsert|delete):/.test(l) || (l.startsWith("rpc:") && l !== "rpc:record_audit"))

// ---------------------------------------------------------------------------
describe("/api/businesses/domains", () => {
  // The business exists, has one domain, "shop.acme.com" is free.
  const healthy = (q: Query): Result => {
    if (q.table === "businesses") return { data: { business_id: BIZ } }
    if (q.table === "business_domains" && q.op === "select") {
      if (q.head) return { count: 2 }
      if (q.columns?.startsWith("domain, business_id")) {
        return { data: { domain: "acme", business_id: BIZ, is_primary: false, is_active: true, label: null } }
      }
      if (q.columns === "business_id") return { data: null }
      return { data: [] }
    }
    return {}
  }

  it("POST audits domain_added (business id, hostname) before inserting", async () => {
    db.handler = healthy
    const res = await domains.POST(json("POST", "http://localhost/api/businesses/domains", { business_id: BIZ, domain: "shop.acme.com" }))
    expect(res.status).toBe(201)
    expect(db.log.indexOf("rpc:record_audit")).toBeLessThan(db.log.indexOf("insert:business_domains"))
    expect(db.audits[0]).toEqual({
      p_action: "domain_added",
      p_actor: OP,
      p_subject_user_id: null,
      p_request_id: null,
      p_detail: { source: "superadmin-panel", business_id: BIZ, domain: "shop.acme.com", is_primary: false, is_active: true },
    })
  })

  it("POST changes nothing when the audit write fails", async () => {
    db.handler = healthy
    auditFails()
    const res = await domains.POST(json("POST", "http://localhost/api/businesses/domains", { business_id: BIZ, domain: "shop.acme.com" }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "audit_failed" })
    expect(mutations()).toEqual([])
  })

  it("POST answers a stable code, not the database message", async () => {
    db.handler = (q) => (q.op === "insert" ? { error: { code: "42501", message: SECRET } } : healthy(q))
    const res = await domains.POST(json("POST", "http://localhost/api/businesses/domains", { business_id: BIZ, domain: "shop.acme.com" }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "create_failed" })
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("server.internal")
  })

  it("PATCH audits domain_changed with the old and new hostname", async () => {
    db.handler = healthy
    const res = await domains.PATCH(
      json("PATCH", "http://localhost/api/businesses/domains", { business_id: BIZ, domain: "acme", new_domain: "acme2" }),
    )
    expect(res.status).toBe(200)
    expect(db.log[db.log.indexOf("rpc:record_audit") + 1]).toBe("insert:business_domains")
    expect(db.audits[0]).toMatchObject({
      p_action: "domain_changed",
      p_detail: { business_id: BIZ, domain: "acme", new_domain: "acme2", is_primary: false, is_active: true },
    })
  })

  it("PATCH changes nothing when the audit write fails", async () => {
    db.handler = healthy
    auditFails()
    const res = await domains.PATCH(json("PATCH", "http://localhost/api/businesses/domains", { business_id: BIZ, domain: "acme", is_active: false }))
    expect(res.status).toBe(500)
    expect(mutations()).toEqual([])
  })

  it("PATCH answers update_failed on a database error", async () => {
    db.handler = (q) => (q.op === "update" ? { error: { code: "42501", message: SECRET } } : healthy(q))
    const res = await domains.PATCH(json("PATCH", "http://localhost/api/businesses/domains", { business_id: BIZ, domain: "acme", label: "x" }))
    expect(await res.json()).toEqual({ error: "update_failed" })
  })

  it("DELETE audits domain_removed before deleting, and fails closed", async () => {
    db.handler = healthy
    const url = `http://localhost/api/businesses/domains?business_id=${BIZ}&domain=acme`
    let res = await domains.DELETE(new Request(url, { method: "DELETE" }))
    expect(res.status).toBe(200)
    expect(db.log.indexOf("rpc:record_audit")).toBeLessThan(db.log.indexOf("delete:business_domains"))
    expect(db.audits[0]).toMatchObject({ p_action: "domain_removed", p_detail: { business_id: BIZ, domain: "acme" } })

    db.log = []
    auditFails()
    res = await domains.DELETE(new Request(url, { method: "DELETE" }))
    expect(res.status).toBe(500)
    expect(mutations()).toEqual([])
  })

  it("DELETE and GET answer stable codes on database errors", async () => {
    db.handler = (q) => (q.op === "delete" ? { error: { code: "XX000", message: SECRET } } : healthy(q))
    let res = await domains.DELETE(new Request(`http://localhost/api/businesses/domains?business_id=${BIZ}&domain=acme`, { method: "DELETE" }))
    expect(await res.json()).toEqual({ error: "delete_failed" })
    db.handler = () => ({ error: { code: "XX000", message: SECRET } })
    res = await domains.GET(new Request(`http://localhost/api/businesses/domains?business_id=${BIZ}`))
    expect(await res.json()).toEqual({ error: "lookup_failed" })
  })
})

// ---------------------------------------------------------------------------
describe("/api/businesses PATCH subdomain", () => {
  const healthy = (q: Query): Result => {
    if (q.table === "businesses") return { data: { business_id: BIZ } }
    if (q.table === "business_domains" && q.op === "select") {
      if (has(q, "is_primary")) return { data: { domain: "old" } }
      return { data: null }
    }
    return {}
  }
  const patch = (body: Record<string, unknown>) => businesses.PATCH(json("PATCH", "http://localhost/api/businesses", { business_id: BIZ, ...body }))

  it("audits subdomain_changed before touching business_domains", async () => {
    db.handler = healthy
    const res = await patch({ subdomain: "new" })
    expect(res.status).toBe(200)
    expect(db.log[0]).toBe("rpc:record_audit")
    expect(db.audits[0]).toMatchObject({
      p_action: "subdomain_changed",
      p_detail: { source: "superadmin-panel", business_id: BIZ, domain: "new", previous_domain: "old" },
    })
  })

  it("changes no domain when the audit write fails", async () => {
    db.handler = healthy
    auditFails()
    const res = await patch({ subdomain: "new" })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "audit_failed" })
    expect(mutations()).toEqual([])
  })

  it("writes no audit row when the subdomain stays the same", async () => {
    db.handler = healthy
    await patch({ subdomain: "old" })
    expect(db.audits).toEqual([])
  })

  it("refuses an invalid subdomain before writing anything else", async () => {
    db.handler = healthy
    const res = await patch({ address: "Via Roma 1", subdomain: "!!" })
    expect(res.status).toBe(400)
    expect(mutations()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe("/api/businesses field checks and error codes", () => {
  const patch = (body: Record<string, unknown>) => businesses.PATCH(json("PATCH", "http://localhost/api/businesses", { business_id: BIZ, ...body }))
  beforeEach(() => {
    db.handler = (q) => (q.table === "businesses" && q.op === "select" ? { data: { business_id: BIZ } } : {})
  })

  it.each([
    [{ logo_url: "javascript:alert(1)" }, "invalid_logo_url"],
    [{ logo_url: "http://cdn.example.com/a.png" }, "invalid_logo_url"],
    [{ logo_url: { href: "https://x" } }, "invalid_logo_url"],
    [{ email: "not-an-email" }, "invalid_email"],
    [{ phone: "call me" }, "invalid_phone"],
    [{ tax_id: "x".repeat(33) }, "invalid_tax_id"],
    [{ address: 42 }, "invalid_address"],
    [{ address: "a".repeat(301) }, "invalid_address"],
    [{ timezone: "Mars/Olympus" }, "invalid_timezone"],
    [{ currency: "EURO" }, "invalid_currency"],
    [{ open_days_and_hours: { funday: { is_open: true } } }, "invalid_open_days_and_hours"],
    [{ open_days_and_hours: { monday: { is_open: true, open: "25:00", close: "02:00+1" } } }, "invalid_open_days_and_hours"],
    [{ open_days_and_hours: "always" }, "invalid_open_days_and_hours"],
  ])("refuses %j with %s and writes nothing", async (body, code) => {
    const res = await patch(body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: code })
    expect(mutations()).toEqual([])
  })

  it("stores checked values", async () => {
    const writes: Query[] = []
    db.handler = (q) => {
      if (q.op !== "select") writes.push(q)
      return q.table === "businesses" && q.op === "select" ? { data: { business_id: BIZ } } : q.table === "business_configurations" ? { data: { config_id: 1 } } : {}
    }
    const hours = { monday: { is_open: true, open: "18:00", close: "02:00+1" }, tuesday: { is_open: false, slots: [] } }
    const res = await patch({ logo_url: "https://cdn.example.com/a.png", email: "Info@Acme.IT", phone: "", timezone: "Europe/Rome", currency: "eur", open_days_and_hours: hours })
    expect(res.status).toBe(200)
    expect(writes[0].values).toMatchObject({ logo_url: "https://cdn.example.com/a.png", email: "info@acme.it", phone: null })
    expect(writes[1].values).toMatchObject({ timezone: "Europe/Rome", currency: "EUR", open_days_and_hours: hours })
  })

  it("PATCH answers lookup_failed / update_failed, never the database message", async () => {
    db.handler = () => ({ error: { code: "XX000", message: SECRET } })
    let res = await patch({ address: "Via Roma 1" })
    expect(await res.json()).toEqual({ error: "lookup_failed" })
    db.handler = (q) => (q.op === "select" ? { data: { business_id: BIZ } } : { error: { code: "XX000", message: SECRET } })
    res = await patch({ address: "Via Roma 1" })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "update_failed" })
  })

  it("GET answers lookup_failed", async () => {
    db.handler = () => ({ error: { code: "XX000", message: SECRET } })
    const res = await businesses.GET(new Request("http://localhost/api/businesses"))
    expect(await res.json()).toEqual({ error: "lookup_failed" })
  })

  it("POST refuses a bad logo_url before creating anything", async () => {
    const res = await businesses.POST(
      json("POST", "http://localhost/api/businesses", {
        business_name: "Acme",
        name_abbreviation: "AC",
        slug: "acme",
        subdomain: "acme",
        owner_kind: "email",
        owner_identifier: "o@acme.it",
        logo_url: "data:image/svg+xml,<svg onload=alert(1)>",
      }),
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: "invalid_logo_url" })
    expect(mutations()).toEqual([])
  })
})

// ---------------------------------------------------------------------------
describe("/api/providers", () => {
  const row = { id: PROVIDER, code: "glovo2", name: "Glovo 2" }

  it("POST audits provider_changed (code, column names) before inserting", async () => {
    db.handler = (q) => (q.op === "insert" ? { data: row } : {})
    const res = await providers.POST(json("POST", "http://localhost/api/providers", { code: "glovo2", name: "Glovo 2", calc_mode: "marketplace" }))
    expect(res.status).toBe(201)
    expect(db.log).toEqual(["rpc:record_audit", "insert:providers"])
    expect(db.audits[0]).toMatchObject({ p_action: "provider_changed", p_subject_user_id: null, p_detail: { operation: "create", provider_code: "glovo2" } })
  })

  it("PATCH audits provider_changed with the id and changed columns, fails closed", async () => {
    db.handler = (q) => (q.op === "update" ? { data: row } : {})
    let res = await providers.PATCH(json("PATCH", "http://localhost/api/providers", { id: PROVIDER, name: "Glovo", is_active: false }))
    expect(res.status).toBe(200)
    expect(db.log).toEqual(["rpc:record_audit", "update:providers"])
    expect(db.audits[0]).toMatchObject({ p_detail: { operation: "update", provider_id: PROVIDER, fields: ["is_active", "name"] } })

    db.log = []
    auditFails()
    res = await providers.PATCH(json("PATCH", "http://localhost/api/providers", { id: PROVIDER, name: "Glovo" }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "audit_failed" })
    expect(mutations()).toEqual([])
  })

  it.each(["javascript:alert(1)", "http://cdn.example.com/g.png", "//evil.com/x.png", "/icons/../../etc", 42])("refuses icon_url %j", async (icon_url) => {
    const res = await providers.PATCH(json("PATCH", "http://localhost/api/providers", { id: PROVIDER, icon_url }))
    expect(res.status).toBe(400)
    expect(mutations()).toEqual([])
  })

  it.each([
    ["https://cdn.example.com/glovo.png", "https://cdn.example.com/glovo.png"],
    ["/icons/glovo.png", "/icons/glovo.png"],
    ["", null],
  ])("accepts icon_url %j", async (icon_url, stored) => {
    let written: unknown
    db.handler = (q) => {
      if (q.op === "update") written = q.values
      return q.op === "update" ? { data: row } : {}
    }
    const res = await providers.PATCH(json("PATCH", "http://localhost/api/providers", { id: PROVIDER, icon_url }))
    expect(res.status).toBe(200)
    expect((written as Record<string, unknown>).icon_url).toBe(stored)
  })

  it("answers stable codes on database errors", async () => {
    db.handler = () => ({ error: { code: "XX000", message: SECRET } })
    expect(await (await providers.GET()).json()).toEqual({ error: "lookup_failed" })
    expect(await (await providers.POST(json("POST", "http://localhost/api/providers", { code: "glovo2", name: "G" }))).json()).toEqual({ error: "create_failed" })
    expect(await (await providers.PATCH(json("PATCH", "http://localhost/api/providers", { id: PROVIDER, name: "G" }))).json()).toEqual({ error: "update_failed" })
  })
})

// ---------------------------------------------------------------------------
describe("/api/businesses/providers", () => {
  const put = (body: Record<string, unknown>) =>
    businessProviders.PUT(json("PUT", "http://localhost/api/businesses/providers", { business_id: BIZ, provider_id: PROVIDER, ...body }))

  it("audits business_provider_changed before the upsert, and fails closed", async () => {
    let res = await put({ is_enabled: false, tax_locked: true })
    expect(res.status).toBe(200)
    expect(db.log).toEqual(["rpc:record_audit", "upsert:business_providers"])
    expect(db.audits[0]).toMatchObject({
      p_action: "business_provider_changed",
      p_detail: { source: "superadmin-panel", business_id: BIZ, provider_id: PROVIDER, is_enabled: false, tax_locked: true },
    })

    db.log = []
    auditFails()
    res = await put({ is_enabled: true })
    expect(res.status).toBe(500)
    expect(mutations()).toEqual([])
  })

  it("answers stable codes, never the trigger or database message", async () => {
    db.handler = () => ({ error: { code: "22023", message: "This provider is mandatory and cannot be disabled" } })
    expect(await (await put({ is_enabled: false })).json()).toEqual({ error: "provider_mandatory" })
    db.handler = () => ({ error: { code: "XX000", message: SECRET } })
    expect(await (await put({ is_enabled: true })).json()).toEqual({ error: "save_failed" })
    db.rpcHandler = () => ({ error: { code: "XX000", message: SECRET } })
    const res = await businessProviders.GET(new Request(`http://localhost/api/businesses/providers?business_id=${BIZ}`))
    expect(await res.json()).toEqual({ error: "lookup_failed" })
  })
})

// ---------------------------------------------------------------------------
describe("/api/admin-nav error codes", () => {
  it("GET and PUT answer stable codes", async () => {
    db.handler = () => ({ error: { code: "XX000", message: SECRET } })
    expect(await (await adminNav.GET()).json()).toEqual({ error: "lookup_failed" })
    const res = await adminNav.PUT(json("PUT", "http://localhost/api/admin-nav", { business_id: BIZ, hidden_items: [] }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "save_failed" })
  })
})
