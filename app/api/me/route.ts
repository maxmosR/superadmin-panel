import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"

export const dynamic = "force-dynamic"

// Lightweight identity check used by the login flow. Uses only the signed-in
// user's session (RLS) — no service-role key required.
// 401 { error: "unauthenticated" } · 403 { error: "not_operator" }
export async function GET() {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  return NextResponse.json({ isAdmin: true, email: guard.admin.email })
}
