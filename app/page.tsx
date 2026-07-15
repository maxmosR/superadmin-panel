import { redirect } from "next/navigation"
import { getPlatformAdmin } from "@/lib/superadmin-auth"
import { SuperAdminDashboard } from "@/components/superadmin/superadmin-dashboard"

export const dynamic = "force-dynamic"

export default async function SuperAdminPage() {
  // Middleware already gates this route, but verify server-side as defence in depth.
  const admin = await getPlatformAdmin()
  if (!admin) redirect("/login")

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost:3000"

  return <SuperAdminDashboard adminEmail={admin.email} rootDomain={rootDomain} />
}
