// L3: the proxy (CSRF / JSON checks, CSP nonce) must run on every API route and
// every page, whatever the path ends with. Only Next's build assets, the image
// optimizer and the favicon skip it.
import { describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server"
import { config, proxy } from "@/proxy"

const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url })

describe("proxy matcher", () => {
  it.each([
    "/",
    "/login",
    "/businesses/00000000-0000-4000-8000-000000000001",
    "/businesses/acme/logo.svg",
    "/operators/photo.png",
    "/api",
    "/api/businesses",
    "/api/businesses/domains",
    "/api/x.png",
    "/api/upload/logo.jpeg",
    "/api/a.gif",
    "/api/a.webp",
    "/api/a.jpg",
    "/api/_next/static/x",
    "/favicon.ico.json",
    "/_next/staticx",
  ])("runs on %s", (url) => {
    expect(runs(url)).toBe(true)
  })

  it.each(["/_next/static/chunks/main.js", "/_next/static/media/font.woff2", "/_next/static/css/a.css", "/_next/image", "/favicon.ico"])(
    "skips %s",
    (url) => {
      expect(runs(url)).toBe(false)
    },
  )
})

describe("proxy on image-like API paths", () => {
  it("refuses a cross-origin POST to /api/x.png and puts the API CSP on it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const res = await proxy(
      new NextRequest("https://superadmin.birraora.app/api/x.png", {
        method: "POST",
        headers: { origin: "https://evil.com", "content-type": "application/json" },
        body: "{}",
      }),
    )
    expect(res.status).toBe(403)
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'")
  })

  it("refuses a text/plain body to /api/x.svg", async () => {
    const res = await proxy(
      new NextRequest("https://superadmin.birraora.app/api/x.svg", {
        method: "POST",
        headers: { origin: "https://superadmin.birraora.app", "content-type": "text/plain" },
        body: "{}",
      }),
    )
    expect(res.status).toBe(415)
  })
})
