import { orders } from "@liberta-labs/bazaar-sdk";
import { describe, expect, it } from "vitest";
import { effectLabel, orderEffect } from "../src/lib/orderEffect";

const long2 = { isLong: true, size: 2n };
const short2 = { isLong: false, size: 2n };

describe("orderEffect", () => {
  it("opens or adds without a position, or on the position's own side", () => {
    expect(orderEffect(true, 1n, null)).toBe("open");
    expect(orderEffect(false, 1n, null)).toBe("open");
    expect(orderEffect(true, 5n, long2)).toBe("open");
    expect(orderEffect(false, 5n, short2)).toBe("open");
    expect(orderEffect(false, 1n, { isLong: true, size: 0n })).toBe("open");
  });

  it("reduces, closes or flips against the position", () => {
    expect(orderEffect(false, 1n, long2)).toBe("reduce");
    expect(orderEffect(false, 2n, long2)).toBe("close");
    expect(orderEffect(false, 3n, long2)).toBe("flip");
    expect(orderEffect(true, 1n, short2)).toBe("reduce");
    expect(orderEffect(true, 2n, short2)).toBe("close");
    expect(orderEffect(true, 3n, short2)).toBe("flip");
    expect(orderEffect(false, orders.CLOSE_POSITION, long2)).toBe("close");
  });

  it("reads as a reduce against the position before an amount is entered", () => {
    expect(orderEffect(false, null, long2)).toBe("reduce");
    expect(orderEffect(true, null, null)).toBe("open");
  });
});

describe("effectLabel", () => {
  it("names the effect", () => {
    expect(effectLabel("open", true, "BTC")).toBe("Long BTC");
    expect(effectLabel("open", false, "BTC")).toBe("Short BTC");
    expect(effectLabel("reduce", false, "BTC")).toBe("Sell BTC");
    expect(effectLabel("reduce", true, "BTC")).toBe("Buy BTC");
    // A sell closes a long; a buy closes a short.
    expect(effectLabel("close", false, "BTC")).toBe("Close long");
    expect(effectLabel("close", true, "BTC")).toBe("Close short");
    expect(effectLabel("flip", false, "BTC")).toBe("Flip to short");
    expect(effectLabel("flip", true, "BTC")).toBe("Flip to long");
  });
});
