// A restaurant's order-receiver devices (operator only).
//   GET   ?business_id=…              → { devices: [{ id, label, created_at, last_seen_at, revoked_at }] }
//   POST  { business_id, label? }     → { code: "XXXXX-XXXXX", expires_at }   pair a new device
//   PATCH { business_id, device_id }  → { ok: true }                        revoke a device
// Pairing calls create_order_device_pairing (service role only): a
// single-use code, valid 15 minutes, stored only as its SHA-256 hash. The
// code is returned once, here, and never logged; the order_receiver app
// redeems it through the order-device Edge Function (`op: "pair"`) for its
// own device key. Revoking sets order_devices.revoked_at, which the Edge
// Function refuses from then on. key_hash is never read.
// Pairing and revoking are audited first (record_audit order_device_paired /
// order_device_changed: business and device ids, never the code or label);
// without the row nothing changes (500 audit_failed).
import { NextResponse } from "next/server"
import { auditFailedResponse, recordOperatorAudit } from "@/lib/operator-audit"
import { requireOperator } from "@/lib/require-operator"
import { createAdminClient } from "@/lib/supabase-admin"
import { isUuid } from "@/lib/zones/validate"
import { groupPairingCode } from "@/lib/order-devices"

export const dynamic = "force-dynamic"

const NO_STORE = { "Cache-Control": "no-store" }
const LABEL_MAX = 60

export async function GET(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const businessId = new URL(request.url).searchParams.get("business_id")
  if (!isUuid(businessId)) return NextResponse.json({ error: "invalid_business_id" }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("order_devices")
    .select("id, label, created_at, last_seen_at, revoked_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
  if (error) {
    console.error(JSON.stringify({ event: "order_devices_read_failed", business: businessId, code: error.code }))
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
  }
  return NextResponse.json({ devices: data ?? [] })
}

export async function POST(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const b = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  if (!isUuid(b.business_id)) return NextResponse.json({ error: "invalid_business_id" }, { status: 400 })
  if (b.label !== undefined && b.label !== null && typeof b.label !== "string") {
    return NextResponse.json({ error: "invalid_label" }, { status: 400 })
  }
  const label = typeof b.label === "string" ? b.label.trim() : ""
  if (label.length > LABEL_MAX) return NextResponse.json({ error: "invalid_label" }, { status: 400 })

  const admin = createAdminClient()
  const audit = await recordOperatorAudit(admin, {
    action: "order_device_paired",
    actorUserId: guard.admin.userId,
    businessId: b.business_id,
    detail: { labelled: label.length > 0 },
  })
  if (!audit.ok) return auditFailedResponse()

  const { data, error } = await admin.rpc("create_order_device_pairing", {
    p_business_id: b.business_id,
    p_label: label || null,
    p_created_by: guard.admin.userId,
  })
  if (error) {
    // 23503: unknown business (foreign key). PGRST202: function not deployed yet.
    if (error.code === "23503") return NextResponse.json({ error: "business_not_found" }, { status: 404 })
    if (error.code === "PGRST202") return NextResponse.json({ error: "pairing_unavailable" }, { status: 503 })
    console.error(JSON.stringify({ event: "order_device_pairing_failed", business: b.business_id, code: error.code }))
    return NextResponse.json({ error: "pairing_failed" }, { status: 500 })
  }
  const result = (data ?? {}) as { code?: unknown; expires_at?: unknown }
  if (typeof result.code !== "string" || typeof result.expires_at !== "string") {
    console.error(JSON.stringify({ event: "order_device_pairing_failed", business: b.business_id, code: "bad_result" }))
    return NextResponse.json({ error: "pairing_failed" }, { status: 500 })
  }
  console.info(JSON.stringify({ event: "order_device_pairing_created", operator: guard.admin.userId, business: b.business_id }))
  return NextResponse.json({ code: groupPairingCode(result.code), expires_at: result.expires_at }, { headers: NO_STORE })
}

export async function PATCH(request: Request) {
  const guard = await requireOperator()
  if (guard.response) return guard.response
  const b = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  if (!isUuid(b.business_id) || !isUuid(b.device_id)) return NextResponse.json({ error: "invalid_body" }, { status: 400 })

  const admin = createAdminClient()
  const audit = await recordOperatorAudit(admin, {
    action: "order_device_changed",
    actorUserId: guard.admin.userId,
    businessId: b.business_id,
    detail: { device_id: b.device_id, change: "revoked" },
  })
  if (!audit.ok) return auditFailedResponse()

  const { data, error } = await admin
    .from("order_devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", b.device_id)
    .eq("business_id", b.business_id)
    .is("revoked_at", null)
    .select("id")
  if (error) {
    console.error(JSON.stringify({ event: "order_device_revoke_failed", business: b.business_id, device: b.device_id, code: error.code }))
    return NextResponse.json({ error: "update_failed" }, { status: 500 })
  }
  if (!data || data.length === 0) {
    // Already revoked, or not this restaurant's device.
    const { data: existing, error: lookupError } = await admin
      .from("order_devices")
      .select("id")
      .eq("id", b.device_id)
      .eq("business_id", b.business_id)
      .maybeSingle()
    if (lookupError) return NextResponse.json({ error: "lookup_failed" }, { status: 500 })
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })
    return NextResponse.json({ ok: true, unchanged: true })
  }
  console.info(
    JSON.stringify({ event: "order_device_revoked", operator: guard.admin.userId, business: b.business_id, device: b.device_id }),
  )
  return NextResponse.json({ ok: true })
}
