import { beforeEach, describe, expect, it, vi } from "vitest"

// The dashboard page must re-check the operator itself, independent of proxy.ts.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`)
  }),
}))
vi.mock("@/lib/superadmin-auth", () => ({ lookupOperator: vi.fn() }))
vi.mock("@/components/superadmin/superadmin-dashboard", () => ({ SuperAdminDashboard: () => null }))

import { lookupOperator } from "@/lib/superadmin-auth"
import SuperAdminPage from "@/app/page"

const admin = vi.mocked(lookupOperator)

beforeEach(() => admin.mockReset())

describe("dashboard page", () => {
  it("redirects a non-operator to /login even when the proxy is bypassed", async () => {
    admin.mockResolvedValue({ status: "not_operator" })
    await expect(SuperAdminPage()).rejects.toThrow("REDIRECT:/login")
  })

  it("renders for an operator", async () => {
    admin.mockResolvedValue({ status: "operator", admin: { userId: "u1", email: "op@example.com" } })
    const el = await SuperAdminPage()
    expect(el.props.adminEmail).toBe("op@example.com")
  })
})
