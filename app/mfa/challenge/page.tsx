import { redirect } from "next/navigation"
import { lookupOperator } from "@/lib/superadmin-auth"
import { MFA_ENROLL_PATH } from "@/lib/operator-status"
import { pageTitle } from "@/lib/i18n/page-title"
import { MfaPanel } from "@/components/superadmin/mfa-panel"

export const dynamic = "force-dynamic"

export const generateMetadata = () => pageTitle((t) => t.mfa.challengeTitle)

// An operator with a verified TOTP factor, signed in with the password only
// (AAL1), confirms a code here to reach AAL2.
export default async function MfaChallengePage() {
  const result = await lookupOperator()
  if (result.status === "operator") redirect("/")
  if (result.status !== "mfa_required") redirect("/login")
  if (!result.hasTotp) redirect(MFA_ENROLL_PATH)
  return <MfaPanel mode="challenge" />
}
