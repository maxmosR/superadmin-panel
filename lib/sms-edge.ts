import { NextResponse } from "next/server"
import { getSupabaseClient } from "@/lib/supabase-server"

/**
 * Forwards a command to the `operator-sms-alias` Edge Function with the
 * operator's own session token (the function checks platform_admins again).
 * The OpenAPI token lives only in Edge secrets; this never sees it.
 * Call only after requireOperator(). Logs the action and status only.
 */
export async function forwardToSmsAlias(body: Record<string, unknown>): Promise<NextResponse> {
  const supabase = await getSupabaseClient()
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return NextResponse.json({ error: "server_misconfigured" }, { status: 500 })

  let res: Response
  try {
    res = await fetch(`${url}/functions/v1/operator-sms-alias`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: anon },
      body: JSON.stringify(body),
    })
  } catch {
    return NextResponse.json({ error: "sms_gateway_unavailable" }, { status: 503 })
  }
  const payload = await res.json().catch(() => ({ error: "server_error" }))
  console.log(JSON.stringify({ event: "sms_alias_action", action: body.action ?? null, status: res.status }))
  return NextResponse.json(payload, { status: res.status })
}
