import { redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { AdminNavMatrix } from "@/components/superadmin/admin-nav-matrix"

export const dynamic = "force-dynamic"

export default async function FeaturesPage() {
  // The page checks the operator itself; proxy.ts is only a convenience.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect("/login")
  return <AdminNavMatrix />
}
