export type OperatorCheck = "operator" | "not_operator" | "mfa_required" | "error"

/**
 * Interpret the `/api/me` answer after sign-in. Pure, so it is unit-tested.
 * 403 `mfa_required` is an operator who still has to enrol or verify a TOTP
 * second factor; any other 401/403 is not an operator.
 */
export function operatorCheckFromStatus(status: number, errorCode?: unknown): OperatorCheck {
  if (status === 403 && errorCode === "mfa_required") return "mfa_required"
  if (status === 401 || status === 403) return "not_operator"
  if (status >= 200 && status < 300) return "operator"
  return "error"
}
