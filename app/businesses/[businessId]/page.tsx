import { notFound, redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { isUuid } from "@/lib/zones/validate"
import { restaurantTitle } from "@/lib/i18n/page-title"
import { RestaurantSetup } from "@/components/superadmin/restaurant-setup"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ businessId: string }> }) {
  return restaurantTitle((await params).businessId, (t) => t.shell.titles.setup)
}

export default async function RestaurantPage({ params }: { params: Promise<{ businessId: string }> }) {
  // The page checks the operator itself; proxy.ts is only a convenience.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect("/login")
  const { businessId } = await params
  if (!isUuid(businessId)) notFound()
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost:3000"
  return <RestaurantSetup businessId={businessId} adminEmail={result.admin.email} rootDomain={rootDomain} />
}
