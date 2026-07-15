import { NextResponse } from "next/server"
import { getPlatformAdmin } from "@/lib/superadmin-auth"

export const dynamic = "force-dynamic"

// Lightweight identity check used by the login flow. Uses only the signed-in
// user's session (RLS) — no service-role key required.
export async function GET() {
  const admin = await getPlatformAdmin()
  if (!admin) return NextResponse.json({ isAdmin: false }, { status: 401 })
  return NextResponse.json({ isAdmin: true, email: admin.email })
}
