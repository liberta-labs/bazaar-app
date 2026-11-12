import { describe, expect, it } from "vitest";
import { assetIconSpec, currencySign, metalTone } from "../src/lib/assetIcon";

describe("assetIconSpec", () => {
  it("reads the asset class and ticker from the Pyth symbol", () => {
    expect(assetIconSpec("Crypto.SOL/USD", "SOL/USD")).toEqual({ kind: "crypto", ticker: "SOL", quote: null });
    expect(assetIconSpec("Equity.US.ORCL/USD", "ORCL/USD")).toEqual({ kind: "stock", ticker: "ORCL", quote: null });
    expect(assetIconSpec("FX.USD/CAD", "USD/CAD")).toEqual({ kind: "fx", ticker: "USD", quote: "CAD" });
    expect(assetIconSpec("Metal.XAU/USD", "XAU/USD")).toEqual({ kind: "metal", ticker: "XAU", quote: null });
    expect(assetIconSpec("Rates.US10Y", "US10Y")).toMatchObject({ kind: "rates", ticker: "US10Y" });
  });

  it("splits commodities into energy, metals and the rest", () => {
    expect(assetIconSpec("Commodities.BRENT/USD", "BRENT/USD").kind).toBe("energy");
    expect(assetIconSpec("Commodities.UKOILSPOT/USD", "UKOIL/USD").kind).toBe("energy");
    expect(assetIconSpec("Commodities.WTI/USD", "WTI/USD").kind).toBe("energy");
    expect(assetIconSpec("Commodities.1OZGOLD/USD", "1OZGOLD/USD").kind).toBe("metal");
    expect(assetIconSpec("Commodities.CORN/USD", "CORN/USD").kind).toBe("commodity");
    expect(assetIconSpec("Energy.NATGAS/USD", "NATGAS/USD").kind).toBe("energy");
  });

  it("falls back to the label when no symbol was read", () => {
    expect(assetIconSpec("", "BTC/USD")).toEqual({ kind: "unknown", ticker: "BTC", quote: null });
    expect(assetIconSpec(undefined, "AAPL/USD")).toEqual({ kind: "unknown", ticker: "AAPL", quote: null });
    expect(assetIconSpec("Weird.THING/USD", "THING/USD").kind).toBe("unknown");
  });

  it("colours metals and signs currencies", () => {
    expect([metalTone("XAU"), metalTone("XAG"), metalTone("XPT"), metalTone("HG")]).toEqual(["gold", "silver", "platinum", "copper"]);
    expect([currencySign("EUR"), currencySign("USD"), currencySign("XYZ"), currencySign(null)]).toEqual(["€", "$", null, null]);
  });
});
