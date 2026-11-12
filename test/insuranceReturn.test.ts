import { previews, ZERO_ADDRESS } from "@liberta-labs/bazaar-sdk";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { RETURN_WINDOW_SECONDS, estimateInsuranceReturn, insuranceFeeOf, sharePriceOfEvent } from "../src/lib/insuranceReturn";

const E18 = 10n ** 18n;
const FRONTEND = "0x00000000000000000000000000000000000001e7" as Address;
const Z = ZERO_ADDRESS as Address;

/** A fill of `notional` dollars with each side's fee in EBP (1/100 bp) of notional. */
function fill(notional: bigint, makerEbp: bigint, takerEbp: bigint, makerIntegrator: Address = Z, takerIntegrator: Address = Z) {
  return {
    notional,
    makerFee: (notional * makerEbp) / 1_000_000n,
    takerFee: (notional * takerEbp) / 1_000_000n,
    makerIntegrator,
    takerIntegrator,
  };
}

describe("insuranceFeeOf", () => {
  it("counts both insurance legs less the 1% bug-bounty skim when no side names an integrator", () => {
    // $10,000 at 0.25 bp maker and 0.75 bp taker: $0.25 + $0.75 of insurance fees, 99% of it to the fund.
    const t = fill(10_000n * E18, 25n, 75n);
    expect(t.makerFee + t.takerFee).toBe(E18);
    expect(insuranceFeeOf(t)).toBe((99n * E18) / 100n);
  });

  it("takes the 0.25 bp integrator leg out of each side that names one", () => {
    // Each side pays its insurance leg plus 0.25 bp to the integrator.
    const t = fill(10_000n * E18, 25n + 25n, 75n + 25n, FRONTEND, FRONTEND);
    expect(t.makerFee + t.takerFee).toBe(15n * E18 / 10n);
    expect(insuranceFeeOf(t)).toBe((99n * E18) / 100n);
  });

  it("matches the SDK's own fee breakdown, side by side", () => {
    const t = fill(12_345n * E18, 50n, 130n, FRONTEND, Z);
    const makerIntegrator = (t.notional * previews.MAKER_INTEGRATOR_FEE_EBP) / 1_000_000n;
    const maker = previews.feeBreakdown({ insurance: t.makerFee - makerIntegrator, integrator: makerIntegrator, total: t.makerFee });
    const taker = previews.feeBreakdown({ insurance: t.takerFee, integrator: 0n, total: t.takerFee });
    expect(insuranceFeeOf(t)).toBe(maker.toInsuranceFund + taker.toInsuranceFund);
  });

  it("never counts a negative leg (a waived fee)", () => {
    expect(insuranceFeeOf({ notional: 10_000n * E18, makerFee: 0n, takerFee: 0n, makerIntegrator: FRONTEND, takerIntegrator: FRONTEND })).toBe(0n);
  });
});

describe("estimateInsuranceReturn", () => {
  it("annualizes the window's insurance fees over the fund's value", () => {
    // $99 to the fund in 30 days on a $10,000 fund: 0.99% a month, 12.045% a year.
    const trades = Array.from({ length: 100 }, () => fill(10_000n * E18, 25n, 75n));
    const r = estimateInsuranceReturn({ trades, fundValue: 10_000n * E18 });
    expect(r.insuranceFees).toBe(99n * E18);
    expect(r.windowSeconds).toBe(RETURN_WINDOW_SECONDS);
    expect(r.feeApr).toBeCloseTo(0.0099 * (365 / 30), 10);
    expect(r.complete).toBe(true);
  });

  it("has no yield for an empty fund, and none from no fills", () => {
    expect(estimateInsuranceReturn({ trades: [fill(E18, 25n, 75n)], fundValue: 0n }).feeApr).toBeNull();
    expect(estimateInsuranceReturn({ trades: [], fundValue: 1_000n * E18 }).feeApr).toBe(0);
  });

  it("reports the share price's change over the window, gains and losses alike", () => {
    expect(estimateInsuranceReturn({ trades: [], fundValue: E18, sharePriceThen: E18, sharePriceNow: (101n * E18) / 100n }).sharePriceChange).toBeCloseTo(0.01, 12);
    expect(estimateInsuranceReturn({ trades: [], fundValue: E18, sharePriceThen: E18, sharePriceNow: (95n * E18) / 100n }).sharePriceChange).toBeCloseTo(-0.05, 12);
    expect(estimateInsuranceReturn({ trades: [], fundValue: E18, sharePriceThen: null, sharePriceNow: E18 }).sharePriceChange).toBeNull();
  });

  it("scales by the window actually covered, and carries whether every fill was read", () => {
    const trades = [fill(10_000n * E18, 25n, 75n)];
    const r = estimateInsuranceReturn({ trades, fundValue: 1_000n * E18, windowSeconds: 365 * 86_400, complete: false });
    expect(r.feeApr).toBeCloseTo(0.00099, 12);
    expect(r.complete).toBe(false);
  });
});

describe("sharePriceOfEvent", () => {
  it("reads the price a deposit or a payout moved at", () => {
    expect(sharePriceOfEvent({ kind: "Deposit", amount: 1_050n * E18, shares: 1_000n * E18 })).toBe((105n * E18) / 100n);
    expect(sharePriceOfEvent({ kind: "WithdrawalExecuted", amount: 500n * E18, shares: 500n * E18 })).toBe(E18);
  });

  it("has none for events that move no money", () => {
    expect(sharePriceOfEvent({ kind: "WithdrawalRequested", amount: 0n, shares: 10n * E18 })).toBeNull();
    expect(sharePriceOfEvent({ kind: "LevyCharged", amount: 0n, shares: E18 })).toBeNull();
  });
});
