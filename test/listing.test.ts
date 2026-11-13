import { type ProSymbol, listings } from "@liberta-labs/bazaar-sdk";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import { continuousMismatch, descriptionMismatch, feedIsLive, scheduleIs247, searchSymbols, suggestCompositeDescription, suggestDescription } from "../src/lib/listing";

const sym = (id: number, symbol: string, name: string, description: string, assetType: string, schedule: string, state = "stable"): ProSymbol => ({
  id,
  feedId: `0x${id.toString(16).padStart(64, "0")}` as Hex,
  symbol,
  name,
  description,
  assetType,
  minChannel: "real_time",
  state,
  schedule,
  sessions: {},
  exponent: -8,
  hermesId: null,
});

// Schedules as Pyth's registry writes them.
const BTC = sym(1, "Crypto.BTC/USD", "BTCUSD", "BITCOIN / US DOLLAR", "crypto", "America/New_York;O,O,O,O,O,O,O;");
const AAPL = sym(922, "Equity.US.AAPL/USD", "AAPL", "APPLE INC", "equity", "America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;1127/0930-1300,1225/C");
const EURUSD = sym(327, "FX.EUR/USD", "EURUSD", "EURO / US DOLLAR", "fx", "America/New_York;O,O,O,O,0000-1700,C,1700-2400;1224/0000-1700,1231/0000-1700");
const DAX = sym(1500, "Equity.DE.DAX/EUR", "DAX", "DAX INDEX", "equity", "Europe/Berlin;0900-1730,0900-1730,0900-1730,0900-1730,0900-1730,C,C;");
const WTI = sym(344, "Commodities.WTI/USD", "WTIUSD", "DEPRECATED FEED - CRUDE OIL WTI / US DOLLAR", "commodity", "America/New_York;0000-1800,0000-1800,0000-1800,0000-1800,0000-1800,C,1800-2400;", "inactive");
const ETH = sym(2, "Crypto.ETH/USD", "ETHUSD", "ETHEREUM / US DOLLAR", "crypto", "America/New_York;O,O,O,O,O,O,O;");

describe("scheduleIs247", () => {
  it("is true only when every day is open and no holiday closes one", () => {
    expect(scheduleIs247(BTC.schedule)).toBe(true);
    expect(scheduleIs247(AAPL.schedule)).toBe(false);
    expect(scheduleIs247(EURUSD.schedule)).toBe(false);
    expect(scheduleIs247("America/New_York;O,O,O,O,O,O,O;1225/C")).toBe(false);
  });

  it("can't tell from a schedule it can't read", () => {
    expect(scheduleIs247("")).toBeNull();
    expect(scheduleIs247("UTC;O,O,O")).toBeNull();
  });
});

describe("suggestDescription", () => {
  it("names the asset, its pair and its feed, in text the factory accepts", () => {
    const d = suggestDescription(BTC);
    expect(d).toBe("Bitcoin / US Dollar, BTC/USD, Pyth Pro feed 1");
    expect(listings.descriptionProblem(d)).toBeNull();
    expect(suggestDescription(AAPL)).toBe("Apple Inc, AAPL/USD, Pyth Pro feed 922");
  });

  it("drops characters the factory refuses, and stays within 200 bytes", () => {
    const odd = sym(9, "Equity.US.ODD/USD", "ODD", "ODD (CLASS A): ÜBER \"QUOTED\" " + "X".repeat(300), "equity", AAPL.schedule);
    const d = suggestDescription(odd);
    expect(listings.descriptionProblem(d)).toBeNull();
    expect(d.length).toBeLessThanOrEqual(200);
  });

  it("describes a composite as its asset in USD through the FX leg", () => {
    const d = suggestCompositeDescription(DAX, EURUSD, false);
    expect(d).toBe("DAX Index, DAX/USD via EUR/USD, Pyth Pro feeds 1500 and 327");
    expect(listings.descriptionProblem(d)).toBeNull();
  });
});

describe("descriptionMismatch", () => {
  it("accepts a description that names the ticker or the asset", () => {
    expect(descriptionMismatch("AAPL on NASDAQ", [AAPL])).toBeNull();
    expect(descriptionMismatch("Apple stock", [AAPL])).toBeNull();
    expect(descriptionMismatch("Bitcoin", [BTC])).toBeNull();
  });

  it("warns when it names another asset", () => {
    expect(descriptionMismatch("AAPL on NASDAQ", [BTC])).toMatch(/doesn't name the asset this feed prices \(BTC\/USD/);
    expect(descriptionMismatch("Ethereum", [BTC])).not.toBeNull();
  });

  it("ignores words every description shares", () => {
    expect(descriptionMismatch("US Dollar Inc", [AAPL])).not.toBeNull();
  });

  it("says nothing before there is a description or a feed", () => {
    expect(descriptionMismatch("", [AAPL])).toBeNull();
    expect(descriptionMismatch("anything", [])).toBeNull();
  });
});

describe("continuousMismatch", () => {
  it("agrees with Pyth's schedule", () => {
    expect(continuousMismatch(true, [BTC], false)).toBeNull();
    expect(continuousMismatch(false, [AAPL], false)).toBeNull();
  });

  it("warns either way when it disagrees", () => {
    expect(continuousMismatch(true, [AAPL], false)).toMatch(/trading hours/);
    expect(continuousMismatch(false, [BTC], false)).toMatch(/around the clock/);
  });

  it("never lets a composite be 24/7", () => {
    expect(continuousMismatch(true, [DAX, EURUSD], true)).toMatch(/composite/);
    expect(continuousMismatch(false, [DAX, EURUSD], true)).toBeNull();
  });
});

describe("searchSymbols and feedIsLive", () => {
  const all = [WTI, EURUSD, AAPL, ETH, BTC, DAX];

  it("finds a feed by ticker first, then by name or description", () => {
    expect(searchSymbols(all, "aapl")[0]).toBe(AAPL);
    expect(searchSymbols(all, "BTC")[0]).toBe(BTC);
    expect(searchSymbols(all, "apple")[0]).toBe(AAPL);
    expect(searchSymbols(all, "crude").map((s) => s.id)).toEqual([344]);
  });

  it("needs at least two characters", () => {
    expect(searchSymbols(all, "a")).toEqual([]);
  });

  it("tells a live feed from a deprecated or inactive one", () => {
    expect(feedIsLive(BTC)).toBe(true);
    expect(feedIsLive(WTI)).toBe(false);
  });
});
