// A settlement's statement, as the restaurant receives it by email (operator only).
//   GET ?id=<settlement uuid> → Statement (lib/finance.ts), 404 when unknown.
// One SQL call, settlement_statement, with the service role after the operator
// check. The statement carries the restaurant's contact details: never log it.
import { NextResponse } from "next/server"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { isUuid } from "@/lib/zones/validate"
import { normaliseStatement } from "@/lib/finance"

export const dynamic = "force-dynamic"

const MISSING = new Set(["PGRST202", "42883", "PGRST205", "42P01"])

export async function GET(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const id = new URL(request.url).searchParams.get("id")
  if (!isUuid(id)) return NextResponse.json({ error: "invalid_id" }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin.rpc("settlement_statement", { p_id: id })
  if (error) {
    if (MISSING.has(error.code)) return NextResponse.json({ error: "finance_unavailable" }, { status: 503 })
    console.error(JSON.stringify({ event: "settlement_statement_failed", settlement: id, code: error.code ?? null }))
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  }
  const statement = normaliseStatement(data)
  if (!statement) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json(statement)
}
