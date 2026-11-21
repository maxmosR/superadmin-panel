import { redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { redirectPathFor } from "@/lib/operator-status"
import { pageTitle } from "@/lib/i18n/page-title"
import { OpenApiAliases } from "@/components/superadmin/sms/openapi-aliases"

export const dynamic = "force-dynamic"

export const generateMetadata = () => pageTitle((t) => t.sms.openapi.title)

export default async function OpenApiAliasesPage() {
  // The page checks the operator itself; proxy.ts is only a convenience.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect(redirectPathFor(result))
  return <OpenApiAliases adminEmail={result.admin.email} />
}
