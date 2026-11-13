import { describe, expect, it } from "vitest";
import { slippageBound, slippageToReach, unfilledText } from "../src/lib/unfilled";

const usd = (n: number) => BigInt(Math.round(n * 100)) * 10n ** 16n;
const btc = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
const side = (prices: number[], complete = true) => ({ levels: prices.map((p) => ({ price: usd(p) })), complete });

describe("slippageBound and slippageToReach", () => {
  it("move the oracle price by the slippage, up for a buy and down for a sell", () => {
    expect(slippageBound(usd(100), 305n, true)).toBe(usd(103.05));
    expect(slippageBound(usd(100), 305n, false)).toBe(usd(96.95));
  });

  it("round the slippage needed up, so the bound reaches the price", () => {
    const oracle = usd(68_827.98);
    const ask = usd(72_885.77);
    const need = slippageToReach(oracle, ask, true);
    expect(need).toBe(590n);
    expect(slippageBound(oracle, need, true) >= ask).toBe(true);
    expect(slippageBound(oracle, need - 1n, true) < ask).toBe(true);
    expect(slippageToReach(usd(100), usd(97), false)).toBe(300n);
  });
});

describe("unfilledText", () => {
  // The case that prompted it: a $89 close of a short, every ask about 5.9% over the oracle price.
  const market = { kind: "market" as const, isLong: true, oracle: usd(68_827.98), slippageBp: 305n, maxSlippageBp: 500n };

  it("says the slippage limit stopped it, names the nearest price, and points past the app's cap to a limit order", () => {
    expect(unfilledText({ ...market, far: side([72_885.77, 72_886.77]) }, 0n, "BTC")).toBe(
      "No sell orders within your 3.05% max slippage: the cheapest is $72,885.77, 5.90% above the oracle price ($68,827.98). That's past the 5.00% a market order can allow, so place a limit order at that price, or wait for a better offer.",
    );
  });

  it("offers the slippage that reaches it when that is allowed", () => {
    expect(unfilledText({ ...market, slippageBp: 100n, far: side([70_000]) }, 0n, "BTC")).toBe(
      "No sell orders within your 1.00% max slippage: the cheapest is $70,000.00, 1.71% above the oracle price ($68,827.98). Set max slippage to 1.71% to reach it, or place a limit order at that price.",
    );
  });

  it("skips the levels that filled and names the one that stopped it", () => {
    const text = unfilledText({ ...market, far: side([68_900, 69_000, 72_885.77]) }, btc(0.0005), "BTC");
    expect(text).toContain("Only 0.0005 BTC fills within your 3.05% max slippage; the next sell order is at $72,885.77");
    expect(text).toContain("The rest would be cancelled.");
  });

  it("says the book ran out when nothing lies past the bound", () => {
    expect(unfilledText({ ...market, far: side([68_900]) }, btc(0.0005), "BTC")).toBe(
      "The book runs out after 0.0005 BTC; the rest would be cancelled. Place a limit order for the rest.",
    );
    expect(unfilledText({ ...market, isLong: false, far: side([]) }, 0n, "BTC")).toBe(
      "There are no buy orders in the book right now, so it would be cancelled. Place a limit order to wait for one.",
    );
  });

  it("measures a sell below the oracle price", () => {
    expect(unfilledText({ ...market, isLong: false, far: side([65_000]) }, 0n, "BTC")).toContain("the highest is $65,000.00, 5.57% below the oracle price");
  });

  it("claims no cause it can't see: the far side not read yet, or read only in part", () => {
    expect(unfilledText({ ...market, far: null }, 0n, "BTC")).toBe("It can't fill now, so it would be cancelled.");
    expect(unfilledText({ ...market, far: side([68_900], false) }, btc(0.0005), "BTC")).toBe("Only part of it can fill now; the rest would be cancelled.");
  });

  it("puts an immediate-or-cancel limit in terms of its limit price", () => {
    expect(unfilledText({ kind: "limit", isLong: true, limitPrice: usd(69_000) }, 0n, "BTC")).toBe(
      "No sell orders at $69,000.00 or better now, so immediate-or-cancel would cancel it.",
    );
  });
});
