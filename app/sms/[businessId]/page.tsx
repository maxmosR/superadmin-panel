import { notFound, redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { redirectPathFor } from "@/lib/operator-status"
import { isUuid } from "@/lib/zones/validate"
import { restaurantTitle } from "@/lib/i18n/page-title"
import { SmsBusinessDetail } from "@/components/superadmin/sms/sms-business-detail"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ businessId: string }> }) {
  return restaurantTitle((await params).businessId, (t) => t.shell.titles.sms)
}

export default async function SmsBusinessPage({ params }: { params: Promise<{ businessId: string }> }) {
  // The page checks the operator itself; proxy.ts is only a convenience.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect(redirectPathFor(result))
  const { businessId } = await params
  if (!isUuid(businessId)) notFound()
  return <SmsBusinessDetail businessId={businessId} adminEmail={result.admin.email} />
}
