import { describe, expect, it } from "vitest";
import { spreadPct } from "../src/lib/book";

const usd = (n: number) => BigInt(Math.round(n * 100)) * 10n ** 16n;

describe("spreadPct", () => {
  it("gives the spread over the mid price, with places enough for a tight one", () => {
    // $1 on about $70,000.
    expect(spreadPct(usd(70_000), usd(70_001))).toBe("0.0014%");
    // 10 cents on about $95: three places.
    expect(spreadPct(usd(94.95), usd(95.05))).toBe("0.105%");
    // A wide testnet book: two places.
    expect(spreadPct(usd(70_000), usd(72_600))).toBe("3.65%");
  });

  it("shows a dash for a crossed or empty book", () => {
    expect(spreadPct(usd(101), usd(100))).toBe("–");
    expect(spreadPct(0n, 0n)).toBe("–");
  });
});
