import "server-only"
import { cookies, headers } from "next/headers"
import { LANG_COOKIE, pickLang, type Lang } from "./core"

/** The language for this request: the saved cookie, else the browser's first language, else Italian. */
export async function getLang(): Promise<Lang> {
  const [c, h] = await Promise.all([cookies(), headers()])
  return pickLang(c.get(LANG_COOKIE)?.value, h.get("accept-language"))
}
