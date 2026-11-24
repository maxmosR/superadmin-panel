import { redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { redirectPathFor } from "@/lib/operator-status"
import { pageTitle } from "@/lib/i18n/page-title"
import { romeRange } from "@/lib/finance"
import { FinanceOverview } from "@/components/superadmin/finance/finance-overview"

export const dynamic = "force-dynamic"

export const generateMetadata = () => pageTitle((t) => t.finance.title)

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // The page checks the operator itself; proxy.ts is only a convenience.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect(redirectPathFor(result))
  const sp = await searchParams
  const r = romeRange(sp.from, sp.to)
  return <FinanceOverview adminEmail={result.admin.email} initialRange={r.ok ? { from: r.from, to: r.to } : null} />
}
