import { redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { pageTitle } from "@/lib/i18n/page-title"
import { AdminNavMatrix } from "@/components/superadmin/admin-nav-matrix"

export const dynamic = "force-dynamic"

export const generateMetadata = () => pageTitle((t) => t.shell.nav.sections)

export default async function FeaturesPage() {
  // The page checks the operator itself; proxy.ts is only a convenience.
  const result = await lookupOperator()
  if (result.status !== "operator") redirect("/login")
  return <AdminNavMatrix adminEmail={result.admin.email} />
}
