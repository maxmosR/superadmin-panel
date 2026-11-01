import { redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { ProvidersPage } from "@/components/superadmin/providers-manager"

export const dynamic = "force-dynamic"

export default async function ProvidersRoute() {
  // The page checks the operator itself; proxy.ts is only a convenience.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect("/login")
  return <ProvidersPage adminEmail={result.admin.email} />
}
