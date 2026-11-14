import { describe, expect, it } from "vitest";
import { openInterestNotional, openInterestSize } from "../src/lib/openInterest";

const E18 = 10n ** 18n;
const oi = (long: number, short: number, longInventory = 0, shortInventory = 0) => ({
  long: BigInt(long) * E18,
  short: BigInt(short) * E18,
  longInventory: BigInt(longInventory) * E18,
  shortInventory: BigInt(shortInventory) * E18,
});

describe("openInterestSize", () => {
  it("counts a matched book once, not long plus short", () => {
    expect(openInterestSize(oi(10, 10))).toBe(10n * E18);
  });

  it("counts what the vault took over from liquidations on its side", () => {
    // A 2-unit short was liquidated: the vault holds it, and the book still has 10 a side.
    expect(openInterestSize(oi(10, 8, 0, 2))).toBe(10n * E18);
    expect(openInterestSize(oi(7, 10, 3, 0))).toBe(10n * E18);
  });

  it("takes the larger side when they differ", () => {
    expect(openInterestSize(oi(10, 9))).toBe(10n * E18);
    expect(openInterestSize(oi(4, 6, 1, 0))).toBe(6n * E18);
  });

  it("is zero with nothing open", () => {
    expect(openInterestSize(oi(0, 0))).toBe(0n);
  });
});

describe("openInterestNotional", () => {
  it("values one side at the stored price", () => {
    // 10 a side at $2,500 is $25,000 of open interest.
    expect(openInterestNotional({ openInterest: oi(10, 10), price: { spot: 2_500n * E18 } })).toBe(25_000n * E18);
  });

  it("is zero without a price", () => {
    expect(openInterestNotional({ openInterest: oi(10, 10), price: { spot: 0n } })).toBe(0n);
  });
});
