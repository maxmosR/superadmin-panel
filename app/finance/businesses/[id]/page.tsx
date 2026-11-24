import { notFound, redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { redirectPathFor } from "@/lib/operator-status"
import { pageTitle } from "@/lib/i18n/page-title"
import { isUuid } from "@/lib/zones/validate"
import { romeRange } from "@/lib/finance"
import { BusinessFinanceView } from "@/components/superadmin/finance/business-finance"

export const dynamic = "force-dynamic"

export const generateMetadata = () => pageTitle((t) => t.finance.business.title)

export default async function BusinessFinancePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // The page checks the operator itself; proxy.ts is only a convenience.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect(redirectPathFor(result))
  const { id } = await params
  if (!isUuid(id)) notFound()
  const sp = await searchParams
  const r = romeRange(sp.from, sp.to)
  return <BusinessFinanceView businessId={id} adminEmail={result.admin.email} initialRange={r.ok ? { from: r.from, to: r.to } : null} />
}
