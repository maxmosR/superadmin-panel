import { beforeEach, describe, expect, it, vi } from "vitest"

// Restaurant tab titles read one name with the service-role client, so the
// operator check must come first, as in every handler.
vi.mock("@/lib/i18n/server", () => ({ getLang: vi.fn(async () => "it") }))
vi.mock("@/lib/superadmin-auth", () => ({ lookupOperator: vi.fn() }))
const maybeSingle = vi.fn()
vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(() => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) })),
}))

import { lookupOperator } from "@/lib/superadmin-auth"
import { createAdminClient } from "@/lib/supabase-admin"
import { restaurantTitle } from "@/lib/i18n/page-title"

const BIZ = "00000000-0000-4000-8000-000000000001"
const lookup = vi.mocked(lookupOperator)

beforeEach(() => {
  lookup.mockReset()
  maybeSingle.mockReset()
  vi.mocked(createAdminClient).mockClear()
})

describe("restaurantTitle", () => {
  it("names the restaurant for an operator", async () => {
    lookup.mockResolvedValue({ status: "operator", admin: { userId: "u1", email: "op@example.com" } })
    maybeSingle.mockResolvedValue({ data: { business_name: "hosuto" } })
    expect(await restaurantTitle(BIZ, (t) => t.shell.titles.setup)).toEqual({ title: "hosuto · Configura" })
  })

  it("never creates the service-role client for a non-operator", async () => {
    lookup.mockResolvedValue({ status: "not_operator" })
    expect(await restaurantTitle(BIZ, (t) => t.shell.titles.setup)).toEqual({})
    expect(createAdminClient).not.toHaveBeenCalled()
  })

  it("falls back for a malformed id or an unknown restaurant", async () => {
    lookup.mockResolvedValue({ status: "operator", admin: { userId: "u1", email: "op@example.com" } })
    expect(await restaurantTitle("nope", (t) => t.shell.titles.zones)).toEqual({})
    maybeSingle.mockResolvedValue({ data: null })
    expect(await restaurantTitle(BIZ, (t) => t.shell.titles.zones)).toEqual({})
  })
})
