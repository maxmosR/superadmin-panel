import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { auditFailedResponse, recordOperatorAudit } from "@/lib/operator-audit"
import { createAdminClient } from "@/lib/supabase-admin"
import { getSupabaseClient } from "@/lib/supabase-server"

export const dynamic = "force-dynamic"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACCOUNT_ID_RE = /^acct_[A-Za-z0-9]{6,}$/

// ---------------------------------------------------------------------------
// POST /api/businesses/payout-account — link the restaurant to a Stripe
// connected account the operator created and verified in the Stripe
// Dashboard. Body: { business_id, stripe_account_id }. Nothing is created.
//
// The Stripe check happens in the Edge Function `operator-create-payout-account`
// (the platform secret key lives only in Edge secrets; it checks the account
// exists under the platform, sets manual payouts and stores its status). This
// route forwards the operator's own session token; the function checks
// platform_admins again. The service-role client is used for one thing only:
// the audit row (record_audit "payout_account_linked", business id, acct id),
// written before the call; without it nothing is sent (500 audit_failed).
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response

  const body = (await req.json().catch(() => null)) as { business_id?: unknown; stripe_account_id?: unknown } | null
  if (!body || typeof body.business_id !== "string" || !UUID_RE.test(body.business_id)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 })
  }
  const accountId = typeof body.stripe_account_id === "string" ? body.stripe_account_id.trim() : ""
  if (!ACCOUNT_ID_RE.test(accountId)) {
    return NextResponse.json({ error: "invalid_account_id" }, { status: 400 })
  }

  const supabase = await getSupabaseClient()
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 })

  const audit = await recordOperatorAudit(createAdminClient(), {
    action: "payout_account_linked",
    actorUserId: guard.admin.userId,
    businessId: body.business_id,
    detail: { stripe_account_id: accountId },
  })
  if (!audit.ok) return auditFailedResponse()

  let res: Response
  try {
    res = await fetch(`${url}/functions/v1/operator-create-payout-account`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: anon },
      body: JSON.stringify({ business_id: body.business_id, stripe_account_id: accountId }),
    })
  } catch {
    return NextResponse.json({ error: "payment_gateway_unavailable" }, { status: 503 })
  }
  const payload = await res.json().catch(() => ({ error: "server_error" }))
  console.log(
    JSON.stringify({ event: "payout_account_link", operator: guard.admin.userId, business: body.business_id, audit: audit.id, status: res.status }),
  )
  return NextResponse.json(payload, { status: res.status })
}
