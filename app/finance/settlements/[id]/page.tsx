import { notFound, redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { redirectPathFor } from "@/lib/operator-status"
import { pageTitle } from "@/lib/i18n/page-title"
import { isUuid } from "@/lib/zones/validate"
import { SettlementStatementView } from "@/components/superadmin/finance/settlement-statement"

export const dynamic = "force-dynamic"

export const generateMetadata = () => pageTitle((t) => t.finance.statement.title)

export default async function SettlementStatementPage({ params }: { params: Promise<{ id: string }> }) {
  // The page checks the operator itself; proxy.ts is only a convenience.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect(redirectPathFor(result))
  const { id } = await params
  if (!isUuid(id)) notFound()
  return <SettlementStatementView settlementId={id} adminEmail={result.admin.email} />
}
