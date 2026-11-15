import { describe, expect, it } from "vitest";
import { WATCHLIST_KEYS, parseWatchlist, toggleWatched, watched } from "../src/state/watchlist";

const BTC = "0x00000000000000000000000000000000000000B1";
const ETH = "0x00000000000000000000000000000000000000E2";

describe("watchlists", () => {
  it("keeps the trading list under the key the one shared list had, and Earn's apart", () => {
    expect(WATCHLIST_KEYS.trade).toBe("bazaar.watchlist");
    expect(WATCHLIST_KEYS.earn).not.toBe(WATCHLIST_KEYS.trade);
  });

  it("stars a market on one list without touching the other", () => {
    toggleWatched("earn", BTC);
    expect(watched("earn").has(BTC.toLowerCase())).toBe(true);
    expect(watched("trade").has(BTC.toLowerCase())).toBe(false);

    toggleWatched("trade", ETH);
    expect(watched("trade").has(ETH.toLowerCase())).toBe(true);
    expect(watched("earn").has(ETH.toLowerCase())).toBe(false);

    // Taking it off one list leaves it on the other.
    toggleWatched("trade", BTC);
    toggleWatched("earn", BTC);
    expect(watched("trade").has(BTC.toLowerCase())).toBe(true);
    expect(watched("earn").has(BTC.toLowerCase())).toBe(false);
  });

  it("reads a stored list strictly", () => {
    expect([...parseWatchlist(JSON.stringify([BTC, "nope", 7]))]).toEqual([BTC.toLowerCase()]);
    expect(parseWatchlist("not json").size).toBe(0);
    expect(parseWatchlist(null).size).toBe(0);
  });
});
