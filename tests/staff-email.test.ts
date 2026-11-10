import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/require-operator", () => ({
  requireOperator: vi.fn(async () => ({ admin: { userId: "op-1", email: null } })),
}))

const state = {
  role: { role: "owner" } as { role: string } | null,
  currentEmail: "old@example.com",
  taken: [] as Array<{ user_id: string }>,
  updateError: null as { status?: number; message?: string } | null,
  updates: [] as Array<{ id: string; attrs: Record<string, unknown> }>,
}

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      const chain = () => q
      Object.assign(q, { select: chain, eq: chain, neq: chain })
      if (table === "user_roles") q.maybeSingle = async () => ({ data: state.role, error: null })
      if (table === "profiles") q.limit = async () => ({ data: state.taken, error: null })
      return q
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { email: state.currentEmail } }, error: null }),
        updateUserById: async (id: string, attrs: Record<string, unknown>) => {
          state.updates.push({ id, attrs })
          return { data: {}, error: state.updateError }
        },
      },
    },
  }),
}))

import { PUT } from "@/app/api/businesses/staff-email/route"

const BIZ = "00000000-0000-0000-0000-000000000001"
const USER = "00000000-0000-0000-0000-000000000002"
const put = (body: unknown) =>
  PUT(new Request("http://localhost/api/businesses/staff-email", { method: "PUT", body: JSON.stringify(body) }))

beforeEach(() => {
  state.role = { role: "owner" }
  state.currentEmail = "old@example.com"
  state.taken = []
  state.updateError = null
  state.updates = []
})

describe("PUT /api/businesses/staff-email", () => {
  it("sets the new email, lowercased and confirmed", async () => {
    const res = await put({ business_id: BIZ, user_id: USER, email: " New@Example.com " })
    expect(res.status).toBe(200)
    expect(state.updates).toEqual([{ id: USER, attrs: { email: "new@example.com", email_confirm: true } }])
  })

  it("refuses an invalid email", async () => {
    const res = await put({ business_id: BIZ, user_id: USER, email: "nope" })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("invalid_email")
    expect(state.updates).toHaveLength(0)
  })

  it("refuses someone without a role at the restaurant", async () => {
    state.role = null
    const res = await put({ business_id: BIZ, user_id: USER, email: "new@example.com" })
    expect(res.status).toBe(404)
    expect(state.updates).toHaveLength(0)
  })

  it("refuses an email another account uses", async () => {
    state.taken = [{ user_id: "someone-else" }]
    const res = await put({ business_id: BIZ, user_id: USER, email: "new@example.com" })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe("email_taken")
    expect(state.updates).toHaveLength(0)
  })

  it("maps Auth's duplicate-email error to email_taken", async () => {
    state.updateError = { status: 422, message: "A user with this email address has already been registered" }
    const res = await put({ business_id: BIZ, user_id: USER, email: "new@example.com" })
    expect(res.status).toBe(409)
  })

  it("does nothing when the email is unchanged", async () => {
    const res = await put({ business_id: BIZ, user_id: USER, email: "OLD@example.com" })
    expect((await res.json()).unchanged).toBe(true)
    expect(state.updates).toHaveLength(0)
  })
})
