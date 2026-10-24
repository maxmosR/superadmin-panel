import { beforeEach, describe, expect, it, vi } from "vitest"

// The dashboard page must re-check the operator itself, independent of proxy.ts.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`)
  }),
}))
vi.mock("@/lib/superadmin-auth", () => ({ getPlatformAdmin: vi.fn() }))
vi.mock("@/components/superadmin/superadmin-dashboard", () => ({ SuperAdminDashboard: () => null }))

import { getPlatformAdmin } from "@/lib/superadmin-auth"
import SuperAdminPage from "@/app/page"

const admin = vi.mocked(getPlatformAdmin)

beforeEach(() => admin.mockReset())

describe("dashboard page", () => {
  it("redirects a non-operator to /login even when the proxy is bypassed", async () => {
    admin.mockResolvedValue(null)
    await expect(SuperAdminPage()).rejects.toThrow("REDIRECT:/login")
  })

  it("renders for an operator", async () => {
    admin.mockResolvedValue({ userId: "u1", email: "op@example.com" })
    const el = await SuperAdminPage()
    expect(el.props.adminEmail).toBe("op@example.com")
  })
})
