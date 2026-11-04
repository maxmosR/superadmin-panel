import { redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { pageTitle } from "@/lib/i18n/page-title"
import { SmsOverview } from "@/components/superadmin/sms/sms-overview"

export const dynamic = "force-dynamic"

export const generateMetadata = () => pageTitle((t) => t.sms.title)

export default async function SmsPage() {
  // The page checks the operator itself; proxy.ts is only a convenience.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect("/login")
  return <SmsOverview adminEmail={result.admin.email} />
}
