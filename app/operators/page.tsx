import { redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { OperatorsManager } from "@/components/superadmin/operators-manager"

export const dynamic = "force-dynamic"

export default async function OperatorsPage() {
  // The page checks the operator itself; proxy.ts is only a convenience.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect("/login")
  return <OperatorsManager />
}
