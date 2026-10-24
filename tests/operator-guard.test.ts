import { readFileSync, readdirSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

// The operator lookup is the only thing the guard depends on; the service-role
// factory is a spy so we can prove it is never reached for refused callers.
vi.mock("@/lib/superadmin-auth", () => ({
  lookupOperator: vi.fn(),
  getPlatformAdmin: vi.fn(),
}))
vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("ADMIN_CLIENT_REACHED")
  }),
}))

import { lookupOperator } from "@/lib/superadmin-auth"
import { createAdminClient } from "@/lib/supabase-admin"
import * as businesses from "@/app/api/businesses/route"
import * as domains from "@/app/api/businesses/domains/route"
import * as me from "@/app/api/me/route"

const lookup = vi.mocked(lookupOperator)
const adminClient = vi.mocked(createAdminClient)

const BIZ = "00000000-0000-0000-0000-000000000001"

function jsonRequest(method: string, url: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Every exported handler that uses the service-role client, with a request
// valid enough that an operator reaches createAdminClient().
const adminHandlers: Array<[string, () => Promise<Response>]> = [
  ["GET /api/businesses", () => businesses.GET()],
  [
    "POST /api/businesses",
    () =>
      businesses.POST(
        jsonRequest("POST", "http://localhost/api/businesses", {
          business_name: "Acme",
          name_abbreviation: "AC",
          owner_email: "owner@example.com",
          owner_password: "password123",
          subdomain: "acme",
        }),
      ),
  ],
  [
    "PATCH /api/businesses",
    () => businesses.PATCH(jsonRequest("PATCH", "http://localhost/api/businesses", { business_id: BIZ })),
  ],
  [
    "GET /api/businesses/domains",
    () => domains.GET(new Request(`http://localhost/api/businesses/domains?business_id=${BIZ}`)),
  ],
  [
    "POST /api/businesses/domains",
    () =>
      domains.POST(
        jsonRequest("POST", "http://localhost/api/businesses/domains", { business_id: BIZ, domain: "acme" }),
      ),
  ],
  [
    "PATCH /api/businesses/domains",
    () =>
      domains.PATCH(
        jsonRequest("PATCH", "http://localhost/api/businesses/domains", {
          business_id: BIZ,
          domain: "acme",
          is_active: false,
        }),
      ),
  ],
  [
    "DELETE /api/businesses/domains",
    () =>
      domains.DELETE(
        new Request(`http://localhost/api/businesses/domains?business_id=${BIZ}&domain=acme`, { method: "DELETE" }),
      ),
  ],
]

const allHandlers: Array<[string, () => Promise<Response>]> = [
  ...adminHandlers,
  ["GET /api/me", () => me.GET()],
]

beforeEach(() => {
  lookup.mockReset()
  adminClient.mockClear()
})

describe("operator guard on every API handler", () => {
  it("has a case for every exported handler under app/api", () => {
    const apiRoot = join(__dirname, "..", "app", "api")
    const routeFiles: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name === "route.ts") routeFiles.push(full)
      }
    }
    walk(apiRoot)

    const discovered: string[] = []
    for (const file of routeFiles) {
      const route = "/api/" + relative(apiRoot, file).split(sep).slice(0, -1).join("/")
      const source = readFileSync(file, "utf8")
      const methods = source.matchAll(
        /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
      )
      for (const [, method] of methods) discovered.push(`${method} ${route}`)
    }

    expect(discovered.length).toBeGreaterThan(0)
    const covered = allHandlers.map(([name]) => name)
    expect(covered.slice().sort()).toEqual(discovered.slice().sort())
  })

  describe.each(allHandlers)("%s", (_name, call) => {
    it("returns 401 unauthenticated without a session, no service-role client", async () => {
      lookup.mockResolvedValue({ status: "unauthenticated" })
      const res = await call()
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: "unauthenticated" })
      expect(adminClient).not.toHaveBeenCalled()
    })

    it("returns 403 not_operator for a signed-in non-operator, no service-role client", async () => {
      lookup.mockResolvedValue({ status: "not_operator" })
      const res = await call()
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: "not_operator" })
      expect(adminClient).not.toHaveBeenCalled()
    })
  })

  describe.each(adminHandlers)("%s as operator", (_name, call) => {
    it("reaches the service-role client", async () => {
      lookup.mockResolvedValue({ status: "operator", admin: { userId: "u1", email: "op@example.com" } })
      await expect(call()).rejects.toThrow("ADMIN_CLIENT_REACHED")
      expect(adminClient).toHaveBeenCalledTimes(1)
    })
  })

  it("GET /api/me confirms an operator", async () => {
    lookup.mockResolvedValue({ status: "operator", admin: { userId: "u1", email: "op@example.com" } })
    const res = await me.GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ isAdmin: true, email: "op@example.com" })
  })
})
