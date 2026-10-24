export type OperatorCheck = "operator" | "not_operator" | "error"

/** Interpret the `/api/me` status after sign-in. Pure, so it is unit-tested. */
export function operatorCheckFromStatus(status: number): OperatorCheck {
  if (status === 401 || status === 403) return "not_operator"
  if (status >= 200 && status < 300) return "operator"
  return "error"
}
