import { describe, expect, it } from "vitest";
import { marketCategory } from "../src/lib/marketCategory";
import { parseWatchlist } from "../src/state/watchlist";

const m = (symbol: string | undefined, label = "X/USD") => ({ legSymbols: symbol ? [symbol] : [], label });

describe("marketCategory", () => {
  it("files each market under its asset class", () => {
    expect(marketCategory(m("Crypto.BTC/USD"))).toBe("crypto");
    expect(marketCategory(m("Equity.US.NVDA/USD"))).toBe("stocks");
    expect(marketCategory(m("Metal.XAU/USD"))).toBe("commodities");
    expect(marketCategory(m("Commodities.UKOILSPOT/USD"))).toBe("commodities");
    expect(marketCategory(m("FX.EUR/USD"))).toBe("fx");
    expect(marketCategory(m("Rates.US10Y"))).toBe("rates");
  });

  it("puts index funds and index feeds under Indices, not Stocks", () => {
    expect(marketCategory(m("Equity.US.SPY/USD"))).toBe("indices");
    expect(marketCategory(m("Equity.US.QQQ/USD"))).toBe("indices");
    expect(marketCategory(m("Index.SPX/USD"))).toBe("indices");
    expect(marketCategory(m("Equity.US.SPOT/USD"))).toBe("stocks");
  });

  it("calls a market with no known symbol Other", () => {
    expect(marketCategory(m(undefined, "ABC/USD"))).toBe("other");
    expect(marketCategory(m("Weird.ABC/USD"))).toBe("other");
  });
});

describe("parseWatchlist", () => {
  const a = "0x41C5F5f49f49F53a7a7669575d1DE539AE8A6A4E";

  it("reads stored addresses in lower case", () => {
    expect([...parseWatchlist(JSON.stringify([a]))]).toEqual([a.toLowerCase()]);
  });

  it("drops anything that isn't a market address, and survives bad storage", () => {
    expect([...parseWatchlist(JSON.stringify([a, "BTC", 7, null, "0x123"]))]).toEqual([a.toLowerCase()]);
    expect(parseWatchlist("{not json").size).toBe(0);
    expect(parseWatchlist(JSON.stringify({ a })).size).toBe(0);
    expect(parseWatchlist(null).size).toBe(0);
  });
});
