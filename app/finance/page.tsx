import { redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { redirectPathFor } from "@/lib/operator-status"
import { pageTitle } from "@/lib/i18n/page-title"
import { FinanceOverview } from "@/components/superadmin/finance/finance-overview"

export const dynamic = "force-dynamic"

export const generateMetadata = () => pageTitle((t) => t.finance.title)

export default async function FinancePage() {
  // The page checks the operator itself; proxy.ts is only a convenience.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect(redirectPathFor(result))
  return <FinanceOverview adminEmail={result.admin.email} />
}
