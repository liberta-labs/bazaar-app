import { BAZAAR_SCALE, EBP_SCALE, previews } from "@liberta-labs/bazaar-sdk";
import { describe, expect, it } from "vitest";
import { maxGateSize, maxOrderSize, orderLev10, takerFeeEbp } from "../src/lib/maxOrder";

const X = BAZAAR_SCALE;
const usd = (n: number) => BigInt(n) * X;

describe("maxOrderSize", () => {
  it("opens what the collateral backs at the leverage, after the fee", () => {
    // $1,000 at 5x with a 1 bp fee: N/5 + N x 0.0001 = 1,000, so N = 4,997.50.
    const size = maxOrderSize({ free: usd(1_000), lev10: 50, price: usd(100), takerEbp: 100n, roomBp: 0n })!;
    const notional = (size * usd(100)) / X;
    expect(notional).toBeLessThanOrEqual(usd(4_998));
    expect(notional).toBeGreaterThan(usd(4_997));
  });

  it("still fits the collateral when it fills as far away as the room allows", () => {
    const room = 75n;
    const size = maxOrderSize({ free: usd(1_000), lev10: 100, price: usd(100), takerEbp: 300n, roomBp: room })!;
    const worst = (size * ((usd(100) * (10_000n + room)) / 10_000n)) / X;
    const margin = (worst * 10n) / 100n + (worst * 300n) / EBP_SCALE;
    expect(margin).toBeLessThanOrEqual(usd(1_000));
    expect(margin).toBeGreaterThan(usd(999));
  });

  it("is nothing without collateral or a price", () => {
    expect(maxOrderSize({ free: 0n, lev10: 50, price: usd(100), takerEbp: 100n, roomBp: 0n })).toBeNull();
    expect(maxOrderSize({ free: usd(10), lev10: 50, price: 0n, takerEbp: 100n, roomBp: 0n })).toBeNull();
  });
});

describe("orderLev10", () => {
  it("is the order's notional over the collateral left after the fee", () => {
    // $200 on $100 of collateral, no fee: 2.0x.
    expect(orderLev10({ notional: usd(200), backing: usd(100), takerEbp: 0n })).toBe(20);
    // $250 on $100 with a 1% fee: 250 / (100 - 2.50) = 2.56x, so 2.6x.
    expect(orderLev10({ notional: usd(250), backing: usd(100), takerEbp: EBP_SCALE / 100n })).toBe(26);
    // $20 on $100: 0.2x, below the slider's 1x.
    expect(orderLev10({ notional: usd(20), backing: usd(100), takerEbp: 100n })).toBe(2);
  });

  it("gives back the leverage Max sized the order at", () => {
    for (const lev10 of [10, 25, 37, 50]) {
      const size = maxOrderSize({ free: usd(1_000), lev10, price: usd(100), takerEbp: 300n, roomBp: 0n })!;
      expect(orderLev10({ notional: (size * usd(100)) / X, backing: usd(1_000), takerEbp: 300n })).toBe(lev10);
    }
  });

  it("is nothing when the collateral can't pay the fee, and zero for no order", () => {
    expect(orderLev10({ notional: usd(200), backing: 0n, takerEbp: 100n })).toBeNull();
    expect(orderLev10({ notional: usd(1_000_000), backing: usd(1), takerEbp: EBP_SCALE / 100n })).toBeNull();
    expect(orderLev10({ notional: 0n, backing: usd(100), takerEbp: 100n })).toBe(0);
  });
});

describe("takerFeeEbp", () => {
  it("follows the protocol's curve: the base rate when the fund is covered, more when it falls short", () => {
    const base = previews.takerInsuranceFeeBase(500n);
    expect(takerFeeEbp({ freeCapital: usd(1_000), targetRatioBp: 500n }, usd(10_000))).toBe(base);
    expect(takerFeeEbp({ freeCapital: usd(100), targetRatioBp: 500n }, usd(10_000))).toBeGreaterThan(base);
    // No open interest: fully covered.
    expect(takerFeeEbp({ freeCapital: 0n, targetRatioBp: 500n }, 0n)).toBe(base);
  });
});

describe("maxGateSize", () => {
  const flat = { isLong: false, size: 0n, entryValue: 0n, collateral: usd(1_000), entryFundingIndex: 0n };
  const none = { longExposure: 0n, shortExposure: 0n, fillDebit: 0n };
  const order = { orderType: 0, isLong: true, limitPrice: 0n, triggerPrice: 0n, maxSlippageBp: 50n };
  const state = (p: typeof flat) => ({ unrealizedPnl: 0n, fundingPnl: 0n, totalPnl: 0n, currentNotional: (p.size * usd(100)) / X, minRequiredCollateral: 0n, availableEquity: p.collateral, equity: p.collateral, isSolvent: true });
  const gate = (size: bigint, p = flat) => previews.creationGate({ ...order, size, hasIntegrator: false }, p, state(p), usd(100), 2_000n, none).ok;

  it("finds the largest size the pair's creation check accepts", () => {
    const size = maxGateSize({ order, position: flat, state: state(flat), mark: usd(100), imrBp: 2_000n, resting: none, upTo: 100n * X });
    expect(gate(size)).toBe(true);
    expect(gate(size + 1n)).toBe(false);
    // About $1,000 / 20% at the far slippage bound: just under 50 units.
    expect(size).toBeLessThan(50n * X);
    expect(size).toBeGreaterThan(49n * X);
  });

  it("counts a same-side position against the collateral, and returns the cap when it passes", () => {
    const held = { ...flat, isLong: true, size: 20n * X, entryValue: usd(2_000) };
    const size = maxGateSize({ order, position: held, state: state(held), mark: usd(100), imrBp: 2_000n, resting: none, upTo: 100n * X });
    expect(size).toBeLessThan(30n * X);
    expect(maxGateSize({ order, position: flat, state: state(flat), mark: usd(100), imrBp: 2_000n, resting: none, upTo: 10n * X })).toBe(10n * X);
  });
});
