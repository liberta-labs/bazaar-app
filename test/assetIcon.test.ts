import { describe, expect, it } from "vitest";
import { assetIconSpec, currencySign, logoColors, metalTone } from "../src/lib/assetIcon";
import { STOCK_LOGOS } from "../src/lib/stockLogoData";

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

describe("stock logos", () => {
  it("has the listed stocks simple-icons covers, and leaves the rest to the generic tile", () => {
    expect(STOCK_LOGOS.NVDA?.hex).toBe("76B900");
    expect(STOCK_LOGOS.MSTR?.path.length).toBeGreaterThan(10);
    expect(STOCK_LOGOS.TSM).toBeUndefined();
    expect(STOCK_LOGOS.SPY).toBeUndefined();
    for (const [ticker, logo] of Object.entries(STOCK_LOGOS)) {
      expect(ticker).toMatch(/^[A-Z]{1,5}$/);
      expect(logo.hex).toMatch(/^[0-9A-F]{6}$/i);
      expect(logo.path).toMatch(/^[Mm]/);
    }
  });

  it("puts a white mark on a dark brand colour, a dark one on a light colour, and outlines the extremes", () => {
    expect(logoColors("76B900")).toEqual({ tile: "#76B900", ink: "#111111", outlined: false });
    expect(logoColors("D9232E")).toEqual({ tile: "#D9232E", ink: "#FFFFFF", outlined: false });
    expect(logoColors("000000")).toMatchObject({ ink: "#FFFFFF", outlined: true });
    expect(logoColors("#FFFFFF")).toMatchObject({ ink: "#111111", outlined: true });
    expect(logoColors("nonsense").tile).toBe("#5B6472");
  });
});
