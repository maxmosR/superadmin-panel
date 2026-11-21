import { describe, expect, it } from "vitest"
import { operatorCheckFromStatus } from "@/lib/operator-check"

describe("operatorCheckFromStatus", () => {
  it.each([
    [200, undefined, "operator"],
    [401, "unauthenticated", "not_operator"],
    [403, "not_operator", "not_operator"],
    [403, undefined, "not_operator"],
    [403, "mfa_required", "mfa_required"],
    [401, "mfa_required", "not_operator"],
    [500, undefined, "error"],
  ] as const)("%i %s → %s", (status, code, expected) => {
    expect(operatorCheckFromStatus(status, code)).toBe(expected)
  })
})
