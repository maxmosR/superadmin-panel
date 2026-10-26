// Singleton loader for the Google Maps JS API (libraries: places, marker).
// Copied from the storefront's lib/google-maps/loader.ts (the repos share no
// packages). The script can only be loaded once per page; concurrent callers
// share one promise. Browser only: never call it during server render.
//
// Env (inlined at build time):
//   NEXT_PUBLIC_GOOGLE_MAPS_KEY     browser key (HTTP-referrer restricted)
//   NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID  Map ID, needed by Advanced Markers

declare global {
  interface Window {
    __gmInit?: () => void
    /** Google calls this when the key rejects the page's domain. */
    gm_authFailure?: () => void
  }
}

type GoogleNamespace = typeof google

export const MAPS_DOMAIN_ERROR = "Google Maps key does not allow this domain. Add it to the key's HTTP referrers."
export const MAPS_KEY_MISSING = "Google Maps is not configured: set NEXT_PUBLIC_GOOGLE_MAPS_KEY for this console."

let loaderPromise: Promise<GoogleNamespace> | null = null
let authFailed = false
const authListeners = new Set<() => void>()

/** Called when Google rejects the key for this domain (gm_authFailure). Returns an unsubscribe. */
export function onMapsAuthFailure(cb: () => void): () => void {
  if (authFailed) cb()
  authListeners.add(cb)
  return () => authListeners.delete(cb)
}

export function mapId(): string {
  // DEMO_MAP_ID works for development; production sets a real Map ID.
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID"
}

export function loadGoogleMaps(): Promise<GoogleNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps can only be loaded in the browser"))
  }
  if (window.google?.maps) return Promise.resolve(window.google as GoogleNamespace)
  if (loaderPromise) return loaderPromise

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY
  if (!apiKey || apiKey.trim() === "") return Promise.reject(new Error(MAPS_KEY_MISSING))

  window.gm_authFailure = () => {
    authFailed = true
    for (const cb of authListeners) cb()
  }

  loaderPromise = new Promise<GoogleNamespace>((resolve, reject) => {
    window.__gmInit = () => {
      if (window.google?.maps) resolve(window.google as GoogleNamespace)
      else reject(new Error(MAPS_DOMAIN_ERROR))
    }
    const script = document.createElement("script")
    const url = new URL("https://maps.googleapis.com/maps/api/js")
    url.searchParams.set("key", apiKey)
    url.searchParams.set("libraries", "places,marker")
    url.searchParams.set("loading", "async")
    url.searchParams.set("callback", "__gmInit")
    url.searchParams.set("v", "weekly")
    script.src = url.toString()
    script.async = true
    script.defer = true
    script.onerror = () => {
      loaderPromise = null
      reject(new Error(MAPS_DOMAIN_ERROR))
    }
    document.head.appendChild(script)
  })
  return loaderPromise
}
