import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`)
  }),
}))
vi.mock("@/lib/superadmin-auth", () => ({ lookupOperator: vi.fn() }))
vi.mock("@/components/superadmin/admin-nav-matrix", () => ({ AdminNavMatrix: () => null }))

const db = vi.hoisted(() => ({
  upserts: [] as Array<{ row: Record<string, unknown>; opts: unknown }>,
  upsertError: null as null | { code: string; message: string },
}))
vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      upsert: (row: Record<string, unknown>, opts: unknown) => {
        db.upserts.push({ row, opts })
        return {
          select: () => ({
            single: async () =>
              db.upsertError ? { data: null, error: db.upsertError } : { data: { hidden_items: row.hidden_items }, error: null },
          }),
        }
      },
    }),
  }),
}))

import { lookupOperator } from "@/lib/superadmin-auth"
import { parseHiddenItems } from "@/lib/admin-nav"
import { PUT } from "@/app/api/admin-nav/route"
import FeaturesPage from "@/app/features/page"

const lookup = vi.mocked(lookupOperator)
const BIZ = "00000000-0000-0000-0000-000000000001"

const put = (body: unknown) =>
  PUT(new Request("http://localhost/api/admin-nav", { method: "PUT", body: JSON.stringify(body) }))

beforeEach(() => {
  lookup.mockReset()
  lookup.mockResolvedValue({ status: "operator", admin: { userId: "op-1", email: "op@example.com" } })
  db.upserts = []
  db.upsertError = null
})

describe("parseHiddenItems", () => {
  it("keeps known keys in sidebar order, without duplicates", () => {
    expect(parseHiddenItems(["scan", "orders", "scan"])).toEqual(["orders", "scan"])
    expect(parseHiddenItems([])).toEqual([])
  })

  it("refuses unknown keys and non-arrays", () => {
    expect(() => parseHiddenItems(["scan", "dropTables"])).toThrow("Unknown section: dropTables")
    expect(() => parseHiddenItems("scan")).toThrow()
  })
})

describe("PUT /api/admin-nav", () => {
  it("saves one restaurant's hidden list, stamped with the operator", async () => {
    const res = await put({ business_id: BIZ, hidden_items: ["scan", "team"] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ business_id: BIZ, hidden_items: ["team", "scan"] })
    expect(db.upserts).toEqual([
      { row: { business_id: BIZ, hidden_items: ["team", "scan"], updated_by: "op-1" }, opts: { onConflict: "business_id" } },
    ])
  })

  it("400 for a bad business_id or an unknown section, nothing written", async () => {
    expect((await put({ business_id: "nope", hidden_items: [] })).status).toBe(400)
    expect((await put({ business_id: BIZ, hidden_items: ["nope"] })).status).toBe(400)
    expect(db.upserts).toEqual([])
  })

  it("404 for a restaurant that doesn't exist", async () => {
    db.upsertError = { code: "23503", message: "fk" }
    const res = await put({ business_id: BIZ, hidden_items: [] })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "business_not_found" })
  })
})

describe("/features page", () => {
  it("redirects a non-operator to /login even when the proxy is bypassed", async () => {
    lookup.mockResolvedValue({ status: "not_operator" })
    await expect(FeaturesPage()).rejects.toThrow("REDIRECT:/login")
  })

  it("renders for an operator", async () => {
    expect(await FeaturesPage()).toBeTruthy()
  })
})
