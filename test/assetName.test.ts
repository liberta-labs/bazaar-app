import { describe, expect, it } from "vitest";
import { assetName } from "../src/lib/assetName";

const m = (label: string, description: string, registry?: string) => ({ label, description, legFeeds: registry === undefined ? [] : [{ description: registry }] });

describe("assetName", () => {
  it("reads a description that leads with Pyth's symbol", () => {
    expect(assetName(m("NVDA/USD", "Equity.US.NVDA/USD NVIDIA Corp"))).toBe("NVIDIA Corp");
    expect(assetName(m("BTC/USD", "Crypto.BTC/USD Bitcoin"))).toBe("Bitcoin");
    expect(assetName(m("SPY/USD", "Equity.US.SPY/USD SPDR S&P 500 ETF Trust"))).toBe("SPDR S&P 500 ETF Trust");
  });

  it("reads a description that leads with the name", () => {
    expect(assetName(m("SBUX/USD", "Starbucks Corporation / US Dollar, SBUX/USD, Pyth Pro feed 1384"))).toBe("Starbucks Corporation");
    expect(assetName(m("SOFI/USD", "SOFI Technologies Inc, SOFI/USD, Pyth Pro feed 2861"))).toBe("SOFI Technologies Inc");
  });

  it("falls back to Pyth's registry, tidied, when the description names nothing past the ticker", () => {
    expect(assetName(m("NVDA/USD", "NVDA", "NVIDIA CORP / US DOLLAR"))).toBe("Nvidia Corp");
    expect(assetName(m("MSTR/USD", "Equity.US.MSTR/USD", "MICROSTRATEGY INC. - CLASS A / US DOLLAR"))).toBe("Microstrategy Inc. - Class A");
    // The registry naming only the ticker gives nothing either.
    expect(assetName(m("SPY/USD", "SPY", "SPY / US DOLLAR"))).toBeNull();
    expect(assetName(m("XYZ/USD", ""))).toBeNull();
  });
});
