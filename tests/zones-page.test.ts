import { beforeEach, describe, expect, it, vi } from "vitest"

// The zones page must re-check the operator itself, independent of proxy.ts.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND")
  }),
}))
vi.mock("@/lib/superadmin-auth", () => ({ lookupOperator: vi.fn() }))
vi.mock("@/components/superadmin/zones/zones-editor", () => ({ ZonesEditor: () => null }))

import { lookupOperator } from "@/lib/superadmin-auth"
import DeliveryZonesPage from "@/app/businesses/[businessId]/zones/page"

const admin = vi.mocked(lookupOperator)
const BIZ = "00000000-0000-4000-8000-000000000001"
const params = (businessId: string) => ({ params: Promise.resolve({ businessId }) })

beforeEach(() => admin.mockReset())

describe("delivery zones page", () => {
  it("redirects a signed-out visitor to /login", async () => {
    admin.mockResolvedValue({ status: "unauthenticated" })
    await expect(DeliveryZonesPage(params(BIZ))).rejects.toThrow("REDIRECT:/login")
  })

  it("redirects a non-operator to /login even when the proxy is bypassed", async () => {
    admin.mockResolvedValue({ status: "not_operator" })
    await expect(DeliveryZonesPage(params(BIZ))).rejects.toThrow("REDIRECT:/login")
  })

  it("renders the editor for an operator", async () => {
    admin.mockResolvedValue({ status: "operator", admin: { userId: "u1", email: "op@example.com" } })
    const el = await DeliveryZonesPage(params(BIZ))
    expect(el.props.businessId).toBe(BIZ)
  })

  it("404s a malformed restaurant id", async () => {
    admin.mockResolvedValue({ status: "operator", admin: { userId: "u1", email: "op@example.com" } })
    await expect(DeliveryZonesPage(params("not-a-uuid"))).rejects.toThrow("NOT_FOUND")
  })
})
