// Request helpers shared by the zone routes.

/** The JSON body as an object, or null when it isn't one. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** First row of a set-returning RPC (PostgREST returns an array). */
export function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? ((data[0] as T) ?? null) : ((data as T) ?? null)
}
