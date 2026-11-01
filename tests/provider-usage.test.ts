import { describe, expect, it } from "vitest"
import { countUsingDefaults, type ProviderLink } from "@/lib/providers"

const link = (business_id: string, over: Partial<ProviderLink> = {}): ProviderLink => ({
  business_id,
  provider_id: "p1",
  is_enabled: true,
  fee_rate: null,
  iva_rate: null,
  stripe_fee_rate: null,
  stripe_fixed_fee: null,
  tax_rate: null,
  ...over,
})
const live = new Set(["a", "b", "c"])

describe("countUsingDefaults", () => {
  it("counts enabled restaurants that leave at least one rate to the default", () => {
    const links = [
      link("a"),
      link("b", { fee_rate: 10, iva_rate: 22, stripe_fee_rate: 1, stripe_fixed_fee: 0.1, tax_rate: 2 }), // all own rates
      link("c", { is_enabled: false }),
    ]
    expect(countUsingDefaults({ id: "p1", is_mandatory: false }, live, links)).toBe(1)
  })

  it("counts a partly customised restaurant, since its other rates still inherit", () => {
    expect(countUsingDefaults({ id: "p1", is_mandatory: false }, live, [link("a", { fee_rate: 12 })])).toBe(1)
  })

  it("counts every live restaurant for a mandatory provider, row or not", () => {
    const links = [link("a", { fee_rate: 10, iva_rate: 22, stripe_fee_rate: 1, stripe_fixed_fee: 0.1, tax_rate: 2 })]
    expect(countUsingDefaults({ id: "p1", is_mandatory: true }, live, links)).toBe(2)
  })

  it("ignores deleted restaurants and other providers", () => {
    const links = [link("gone"), link("a", { provider_id: "p2" })]
    expect(countUsingDefaults({ id: "p1", is_mandatory: false }, live, links)).toBe(0)
  })
})
