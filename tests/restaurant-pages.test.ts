import { beforeEach, describe, expect, it, vi } from "vitest"

// The restaurant setup page and the providers page re-check the operator
// themselves, independent of proxy.ts.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND")
  }),
}))
vi.mock("@/lib/superadmin-auth", () => ({ lookupOperator: vi.fn() }))
vi.mock("@/components/superadmin/restaurant-setup", () => ({ RestaurantSetup: () => null }))
vi.mock("@/components/superadmin/providers-manager", () => ({ ProvidersPage: () => null }))

import { lookupOperator } from "@/lib/superadmin-auth"
import RestaurantPage from "@/app/businesses/[businessId]/page"
import ProvidersRoute from "@/app/providers/page"

const admin = vi.mocked(lookupOperator)
const BIZ = "00000000-0000-4000-8000-000000000001"
const params = (businessId: string) => ({ params: Promise.resolve({ businessId }) })
const operator = { status: "operator", admin: { userId: "u1", email: "op@example.com" } } as const

beforeEach(() => admin.mockReset())

describe("restaurant setup page", () => {
  it("redirects a signed-out visitor to /login", async () => {
    admin.mockResolvedValue({ status: "unauthenticated" })
    await expect(RestaurantPage(params(BIZ))).rejects.toThrow("REDIRECT:/login")
  })
  it("redirects a non-operator to /login even when the proxy is bypassed", async () => {
    admin.mockResolvedValue({ status: "not_operator" })
    await expect(RestaurantPage(params(BIZ))).rejects.toThrow("REDIRECT:/login")
  })
  it("renders the setup for an operator", async () => {
    admin.mockResolvedValue(operator)
    const el = await RestaurantPage(params(BIZ))
    expect(el.props.businessId).toBe(BIZ)
    expect(el.props.adminEmail).toBe("op@example.com")
  })
  it("404s a malformed restaurant id", async () => {
    admin.mockResolvedValue(operator)
    await expect(RestaurantPage(params("not-a-uuid"))).rejects.toThrow("NOT_FOUND")
  })
})

describe("providers page", () => {
  it("redirects a non-operator to /login", async () => {
    admin.mockResolvedValue({ status: "not_operator" })
    await expect(ProvidersRoute()).rejects.toThrow("REDIRECT:/login")
  })
  it("renders for an operator", async () => {
    admin.mockResolvedValue(operator)
    const el = await ProvidersRoute()
    expect(el.props.adminEmail).toBe("op@example.com")
  })
})
