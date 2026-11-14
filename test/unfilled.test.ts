import { describe, expect, it } from "vitest";
import { slippageBound, slippageToReach, unfilledText } from "../src/lib/unfilled";

const usd = (n: number) => BigInt(Math.round(n * 100)) * 10n ** 16n;
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

  it("says the slippage stopped it, and offers more slippage while that can reach the next order", () => {
    expect(unfilledText({ ...market, slippageBp: 100n, far: side([70_000]) }, false)).toBe("Nothing fills within your 1.00% slippage. Raise it or use a limit order.");
    // The report that asked for it shorter: part fills within 0.50%, the next ask 0.52% away.
    expect(unfilledText({ ...market, oracle: usd(67_156.3), slippageBp: 50n, far: side([67_200, 67_501]) }, true)).toBe(
      "Only part of it fills within your 0.50% slippage. Raise it or use a limit order.",
    );
  });

  it("points only to a limit order when the next order is past the app's slippage cap", () => {
    expect(unfilledText({ ...market, far: side([72_885.77, 72_886.77]) }, false)).toBe("Nothing fills within your 3.05% slippage. Use a limit order.");
    expect(unfilledText({ ...market, isLong: false, far: side([65_000]) }, false)).toBe("Nothing fills within your 3.05% slippage. Use a limit order.");
  });

  it("names no figure that moves with the book: no size, no distance to the next order", () => {
    const lines = [
      unfilledText({ ...market, far: side([68_900, 69_000, 72_885.77]) }, true),
      unfilledText({ ...market, slippageBp: 100n, far: side([70_000]) }, false),
    ];
    for (const l of lines) expect(l).not.toMatch(/BTC|\$|1\.71%|5\.90%/);
  });

  it("says the book ran out when nothing lies past the bound", () => {
    expect(unfilledText({ ...market, far: side([68_900]) }, true)).toBe("The book runs out before it all fills. Try a limit order.");
    expect(unfilledText({ ...market, isLong: false, far: side([]) }, false)).toBe("No buy orders in the book. Try a limit order.");
  });

  it("claims no cause it can't see: the far side not read yet, or read only in part", () => {
    expect(unfilledText({ ...market, far: null }, false)).toBe("It can't fill now.");
    expect(unfilledText({ ...market, far: side([68_900], false) }, true)).toBe("Only part of it can fill now.");
  });

  it("puts an immediate-or-cancel limit in terms of its limit price", () => {
    expect(unfilledText({ kind: "limit", isLong: true, limitPrice: usd(69_000) }, false)).toBe("Nothing fills at $69,000.00 or better.");
    expect(unfilledText({ kind: "limit", isLong: true, limitPrice: usd(69_000) }, true)).toBe("Only part of it fills at $69,000.00 or better.");
  });
});
