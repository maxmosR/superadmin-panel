import { redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { SuperAdminDashboard } from "@/components/superadmin/superadmin-dashboard"

export const dynamic = "force-dynamic"

export default async function SuperAdminPage() {
  // proxy.ts redirect is only a convenience; this server-side check is the real gate.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect("/login")

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost:3000"

  return <SuperAdminDashboard adminEmail={result.admin.email} rootDomain={rootDomain} />
}
