import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: { data: { ok: true, action: "grant" } as unknown, error: null as unknown },
  active: [] as Array<{ user_id: string }>,
  updated: [] as Array<Record<string, unknown>>,
}))

vi.mock("@/lib/superadmin-auth", () => ({
  lookupOperator: vi.fn(async () => ({ status: "operator", admin: { userId: "op-1", email: "op@x" } })),
}))
vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: () => {
    const chain = (rows: unknown) => {
      const b: Record<string, unknown> = {}
      for (const m of ["select", "eq", "in", "order"]) b[m] = () => b
      b.maybeSingle = async () => ({ data: (rows as unknown[])[0] ?? null, error: null })
      b.then = (ok: (v: unknown) => unknown) => ok({ data: rows, error: null })
      b.update = (v: Record<string, unknown>) => {
        state.updated.push(v)
        return b
      }
      return b
    }
    return {
      from: (t: string) => chain(t === "platform_admins" ? state.active : []),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        state.rpc.push({ fn, args })
        return state.rpcResult
      },
      auth: { admin: { createUser: async () => ({ data: { user: { id: "new-user" } }, error: null }) } },
    }
  },
}))

import { parseIdentifier, SLUG_RE, SMS_SENDER_RE } from "@/lib/roles"
import * as roles from "@/app/api/businesses/roles/route"
import * as operators from "@/app/api/operators/route"

const BIZ = "00000000-0000-0000-0000-000000000001"
const USER = "00000000-0000-0000-0000-000000000002"
const json = (method: string, body: unknown) =>
  new Request("http://localhost/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

beforeEach(() => {
  state.rpc = []
  state.rpcResult = { data: { ok: true, action: "grant" }, error: null }
  state.active = []
  state.updated = []
})

describe("no console code writes profiles.role or profiles.business_id", () => {
  const files: string[] = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(n)) files.push(p)
    }
  }
  for (const d of ["app", "components", "lib"]) walk(join(__dirname, "..", d))

  it.each(files)("%s", (file) => {
    const src = readFileSync(file, "utf8")
    expect(src).not.toMatch(/from\("profiles"\)\s*\.(insert|update|upsert)/)
    expect(src).not.toMatch(/owner_password|signInWithPassword\(\{[^}]*owner/)
  })
})

describe("validation", () => {
  it("slugs: 3–40 of a-z 0-9 -", () => {
    expect(SLUG_RE.test("hosuto")).toBe(true)
    expect(SLUG_RE.test("ab")).toBe(false)
    expect(SLUG_RE.test("Hosuto")).toBe(false)
    expect(SLUG_RE.test("hosuto.it")).toBe(false)
  })
  it("SMS sender: 3–11 letters, digits, spaces", () => {
    expect(SMS_SENDER_RE.test("Hosuto")).toBe(true)
    expect(SMS_SENDER_RE.test("TooLongSender")).toBe(false)
    expect(SMS_SENDER_RE.test("Ho!")).toBe(false)
  })
  it("identifiers", () => {
    expect(parseIdentifier("phone", "333 123 4567")).toEqual({ kind: "phone", e164: "+393331234567" })
    expect(parseIdentifier("email", " A@B.it ")).toEqual({ kind: "email", email: "a@b.it" })
    expect(parseIdentifier("phone", "+000000000000")).toBeNull()
  })
})

describe("operator role writes", () => {
  it("go through set_role_assignment as an operator", async () => {
    const res = await roles.POST(json("POST", { business_id: BIZ, identifier: "w@x.it", kind: "email", role: "worker" }))
    expect(res.status).toBe(200)
    expect(state.rpc.at(-1)).toEqual({
      fn: "set_role_assignment",
      args: { p_actor: "op-1", p_actor_kind: "operator", p_business_id: BIZ, p_user_id: "new-user", p_role: "worker" },
    })
  })

  it("the last owner can't be removed (409)", async () => {
    state.rpcResult = { data: null, error: { code: "P0001", message: "last_owner" } }
    const res = await roles.DELETE(json("DELETE", { business_id: BIZ, user_id: USER }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "last_owner" })
  })
})

describe("operators", () => {
  it("the last active operator can't be deactivated", async () => {
    state.active = [{ user_id: USER }]
    const res = await operators.PATCH(json("PATCH", { user_id: USER, is_active: false }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "last_operator" })
    expect(state.updated).toEqual([])
  })
})
