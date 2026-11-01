import { redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { pageTitle } from "@/lib/i18n/page-title"
import { ProvidersPage } from "@/components/superadmin/providers-manager"

export const dynamic = "force-dynamic"

export const generateMetadata = () => pageTitle((t) => t.shell.nav.providers)

export default async function ProvidersRoute() {
  // The page checks the operator itself; proxy.ts is only a convenience.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect("/login")
  return <ProvidersPage adminEmail={result.admin.email} />
}
