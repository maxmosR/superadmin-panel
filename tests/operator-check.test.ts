import { describe, expect, it } from "vitest"
import { operatorCheckFromStatus } from "@/lib/operator-check"

describe("operatorCheckFromStatus", () => {
  it.each([
    [200, "operator"],
    [401, "not_operator"],
    [403, "not_operator"],
    [500, "error"],
  ] as const)("%i → %s", (status, expected) => {
    expect(operatorCheckFromStatus(status)).toBe(expected)
  })
})
