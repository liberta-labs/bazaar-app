import { markets } from "@liberta-labs/bazaar-sdk";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { BoardError, BoardPrices, fetchBoard, parseBoard, priceAge } from "../src/lib/board";

const E18 = 10n ** 18n;
const BTC_FEED = "0x0000000000000000000000000000000000000000000000000000000000000001";
const AAPL_FEED = "0x00000000000000000000000000000000000000000000000000000000000003E8";
const BTC_PAIR = "0x1111111111111111111111111111111111111111" as Address;
const BTC_MAINNET_PAIR = "0x2222222222222222222222222222222222222222" as Address;
const AAPL_PAIR = "0x3333333333333333333333333333333333333333" as Address;
const GENERATED = 1_794_236_405;

function doc(over: { aaplPublish?: number; aaplPrice?: unknown; extra?: Record<string, unknown> } = {}) {
  return {
    version: 1,
    generatedAt: GENERATED,
    chains: [{ name: "testnet", chainId: 421614, factory: "0x9f077B7D49EE7B451ae0858e391dC6960F144612", marketsReadAt: GENERATED - 5 }],
    markets: {
      [BTC_FEED]: {
        label: "BTC/USD",
        legs: [BTC_FEED],
        invertQuote: false,
        continuous: true,
        listings: [
          { chainId: 42161, pair: BTC_MAINNET_PAIR },
          { chainId: 421614, pair: BTC_PAIR },
        ],
        price: { spot: "74027500000000000000000", low: "74020100000000000000000", high: "74034900000000000000000", publishTime: GENERATED - 1, confidenceOk: true },
      },
      // Keys arrive in any case; the board's own are lowercase.
      [AAPL_FEED]: {
        label: "AAPL/USD",
        legs: [AAPL_FEED],
        invertQuote: false,
        continuous: false,
        listings: [{ chainId: 421614, pair: AAPL_PAIR }],
        price:
          over.aaplPrice !== undefined
            ? over.aaplPrice
            : { spot: "230000000000000000000", low: "229900000000000000000", high: "230100000000000000000", publishTime: over.aaplPublish ?? GENERATED - 2, confidenceOk: false },
      },
      ...over.extra,
    },
  };
}

describe("parseBoard", () => {
  it("reads every price as an exact 18-decimal bigint, keyed by the lowercase feed id", () => {
    const b = parseBoard(doc());
    expect(b.generatedAt).toBe(GENERATED);
    const btc = b.markets.get(BTC_FEED)!;
    expect(btc.label).toBe("BTC/USD");
    expect(btc.price!.spot).toBe(740_275n * E18 / 10n);
    expect(btc.price!.low).toBe(740_201n * E18 / 10n);
    expect(btc.price!.high).toBe(740_349n * E18 / 10n);
    expect(b.markets.get(AAPL_FEED.toLowerCase())!.continuous).toBe(false);
    expect(b.markets.has(AAPL_FEED)).toBe(false);
  });

  it("keeps a market whose price has not arrived, with a null price", () => {
    const b = parseBoard(doc({ aaplPrice: null }));
    expect(b.markets.get(AAPL_FEED.toLowerCase())!.price).toBeNull();
  });

  it("skips a malformed market without losing the others", () => {
    const b = parseBoard(doc({ extra: { "0xbad": { label: "BAD", continuous: true, listings: [], price: { spot: 1.5, low: "1", high: "1", publishTime: 1 } } } }));
    expect(b.markets.has("0xbad")).toBe(false);
    expect(b.markets.size).toBe(2);
  });

  it("refuses a document that is not a board", () => {
    expect(() => parseBoard(null)).toThrow(BoardError);
    expect(() => parseBoard({ generatedAt: "soon", markets: {} })).toThrow(BoardError);
    expect(() => parseBoard({ generatedAt: 1, markets: [] })).toThrow(BoardError);
  });
});

describe("BoardPrices (the SDK's LivePriceView)", () => {
  it("prices a pair through the board's listing for this chain only", () => {
    const view = new BoardPrices(parseBoard(doc()), 421614);
    expect(view.price(BTC_PAIR)).toEqual({ spot: 740_275n * E18 / 10n, low: 740_201n * E18 / 10n, high: 740_349n * E18 / 10n, publishTime: GENERATED - 1 });
    // The same feed's mainnet pair is not this chain's market.
    expect(view.price(BTC_MAINNET_PAIR)).toBeNull();
    // Any case of the address.
    expect(view.price(BTC_PAIR.toUpperCase().replace("0X", "0x") as Address)).not.toBeNull();
  });

  it("falls back to the market's base feed id for a pair the board does not list on this chain", () => {
    const other = "0x4444444444444444444444444444444444444444" as Address;
    const view = new BoardPrices(parseBoard(doc()), 421614, (p) => (p === other ? (BTC_FEED as Hex) : undefined));
    expect(view.price(other)!.spot).toBe(740_275n * E18 / 10n);
  });

  it("has no price for a market the board leaves out (settling or terminated)", () => {
    const view = new BoardPrices(parseBoard(doc()), 421614);
    const settling = "0x5555555555555555555555555555555555555555" as Address;
    expect(view.price(settling)).toBeNull();
    expect(view.venueClosed(settling)).toBe(false);
    expect(view.spot(settling)).toBeNull();
    expect(view.confidenceOk(settling)).toBeNull();
  });

  it("judges a trading-hours venue closed only past VENUE_CLOSED_AFTER seconds behind the board", () => {
    const at = (age: number) => new BoardPrices(parseBoard(doc({ aaplPublish: GENERATED - age })), 421614);
    expect(at(markets.VENUE_CLOSED_AFTER).venueClosed(AAPL_PAIR)).toBe(false);
    expect(at(markets.VENUE_CLOSED_AFTER + 1).venueClosed(AAPL_PAIR)).toBe(true);
    expect(at(3600).venueClosed(AAPL_PAIR)).toBe(true);
  });

  it("never judges a 24/7 market closed, however old its price", () => {
    const d = doc();
    (d.markets[BTC_FEED] as { price: { publishTime: number } }).price.publishTime = GENERATED - 10_000;
    expect(new BoardPrices(parseBoard(d), 421614).venueClosed(BTC_PAIR)).toBe(false);
  });

  it("reports the spot alone and Pyth's confidence flag", () => {
    const view = new BoardPrices(parseBoard(doc()), 421614);
    expect(view.spot(AAPL_PAIR)).toBe(230n * E18);
    expect(view.confidenceOk(AAPL_PAIR)).toBe(false);
    expect(view.confidenceOk(BTC_PAIR)).toBe(true);
  });
});

describe("fetchBoard and priceAge", () => {
  it("fetches /board.json from the service and parses it", async () => {
    const seen: string[] = [];
    const fake = (async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify(doc()), { status: 200 });
    }) as unknown as typeof fetch;
    const b = await fetchBoard("http://localhost:8080", fake);
    expect(seen).toEqual(["http://localhost:8080/board.json"]);
    expect(b.markets.size).toBe(2);
  });

  it("throws on an HTTP error", async () => {
    const fake = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    await expect(fetchBoard("http://x", fake)).rejects.toThrow(/503/);
  });

  it("counts a price's age in whole seconds, never negative", () => {
    expect(priceAge(100, 112.9)).toBe(12);
    expect(priceAge(100, 90)).toBe(0);
  });
});
