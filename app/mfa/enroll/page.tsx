import { redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { MFA_CHALLENGE_PATH } from "@/lib/operator-status"
import { pageTitle } from "@/lib/i18n/page-title"
import { MfaPanel } from "@/components/superadmin/mfa-panel"

export const dynamic = "force-dynamic"

export const generateMetadata = () => pageTitle((t) => t.mfa.enrollTitle)

// An operator without a verified TOTP factor sets one up here.
export default async function MfaEnrollPage() {
  const result = await lookupOperator()
  if (result.status === "operator") redirect("/")
  if (result.status !== "mfa_required") redirect("/login")
  if (result.hasTotp) redirect(MFA_CHALLENGE_PATH)
  return <MfaPanel mode="enroll" />
}
