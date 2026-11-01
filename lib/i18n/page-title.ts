import "server-only"
import type { Metadata } from "next"
import { messages, type Messages } from "./messages"
import { getLang } from "./server"
import { fmt } from "./core"
import { isUuid } from "@/lib/zones/validate"

/**
 * A page's browser-tab title in the request's language. The root layout's
 * template adds " · BirraOra" for pages below it; the home page sits at the
 * layout's own level, where Next doesn't apply the template, so `root` writes
 * the full title.
 */
export async function pageTitle(pick: (t: Messages) => string, opts: { root?: boolean } = {}): Promise<Metadata> {
  const title = pick(messages[await getLang()])
  return { title: opts.root ? { absolute: `${title} · BirraOra` } : title }
}

/**
 * Title for a restaurant's own page ("hosuto · Configura"). The operator is
 * checked before the service-role client is created; anyone else, or an
 * unknown id, gets the plain console title. Only the name is read.
 */
export async function restaurantTitle(
  businessId: string,
  pick: (t: Messages) => string,
): Promise<Metadata> {
  const t = messages[await getLang()]
  const { lookupOperator } = await import("@/lib/superadmin-auth")
  const op = await lookupOperator()
  if (op.status !== "operator" || !isUuid(businessId)) return {}
  const { createAdminClient } = await import("@/lib/supabase-admin")
  const { data } = await createAdminClient().from("businesses").select("business_name").eq("business_id", businessId).maybeSingle()
  const name = (data as { business_name?: string } | null)?.business_name
  return name ? { title: fmt(pick(t), { name }) } : {}
}
