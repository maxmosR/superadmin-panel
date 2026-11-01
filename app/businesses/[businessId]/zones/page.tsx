import { notFound, redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { isUuid } from "@/lib/zones/validate"
import { restaurantTitle } from "@/lib/i18n/page-title"
import { ZonesEditor } from "@/components/superadmin/zones/zones-editor"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ businessId: string }> }) {
  return restaurantTitle((await params).businessId, (t) => t.shell.titles.zones)
}

export default async function DeliveryZonesPage({ params }: { params: Promise<{ businessId: string }> }) {
  // The page checks the operator itself; proxy.ts is only a convenience.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect("/login")
  const { businessId } = await params
  if (!isUuid(businessId)) notFound()
  return <ZonesEditor businessId={businessId} />
}
