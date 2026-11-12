/**
 * The price board: the service's /board.json, read every 10 seconds for display, and an adapter that
 * hands it to the SDK as a LivePriceView. The board is the only price source the page has: it holds
 * no Pyth key, and every call that needs a fresh signed price goes through the relayer.
 */
import { markets as mk, toNumber18 } from "@liberta-labs/bazaar-sdk";
import type { Address, Hex } from "viem";

/** One market's price on the board, as 18-decimal bigints. */
export interface BoardPrice {
  readonly spot: bigint;
  readonly low: bigint;
  readonly high: bigint;
  /** The second the price was generated in (a composite's older leg). */
  readonly publishTime: number;
  /** False while Pyth's confidence is wider than the 2% the oracle accepts. */
  readonly confidenceOk: boolean;
  /**
   * The price about 24 hours ago from Pyth's history, composed as `spot` is: what the 24-hour change is
   * measured against. Null when the board does not know it, or is one that does not publish it.
   */
  readonly dayAgo: BoardDayAgo | null;
}

export interface BoardDayAgo {
  readonly spot: bigint;
  /** The second that price was generated in. */
  readonly at: number;
}

/** A listing's trading over the last 24 hours, from the subgraph's hourly candles, read by the service. */
export interface BoardDay {
  /** USDC traded, at 18 decimals. */
  readonly volume: bigint;
  readonly trades: number;
}

export interface BoardListing {
  readonly chainId: number;
  readonly pair: Address;
  /** Null when the board does not know it, or is one that does not publish it. */
  readonly day: BoardDay | null;
}

/** A chain's subgraph as the service last found it: whether it answers, and how far its history trails the chain. */
export interface BoardSubgraph {
  readonly reachable: boolean;
  readonly blocksBehind: number | null;
  readonly secondsBehind: number | null;
  readonly hasIndexingErrors: boolean;
  /** Unix seconds; null before the service's first check. */
  readonly checkedAt: number | null;
}

export interface BoardMarket {
  /** The base feed id, lowercase: the key the board uses. */
  readonly feedId: Hex;
  readonly label: string;
  readonly continuous: boolean;
  readonly listings: readonly BoardListing[];
  /** Null until Pyth has sent a price for every leg. */
  readonly price: BoardPrice | null;
}

export interface Board {
  readonly version: number;
  /** Unix seconds the snapshot was published at. */
  readonly generatedAt: number;
  readonly markets: ReadonlyMap<string, BoardMarket>;
  /**
   * Each chain's subgraph, for the chains whose history the service reads: for those it also publishes
   * each listing's `day` and answers history queries (lib/subgraph.ts). A chain is missing when the
   * service reads no history for it, or is one that does not publish this.
   */
  readonly subgraphs: ReadonlyMap<number, BoardSubgraph>;
}

/** The board answered something that is not a board. */
export class BoardError extends Error {}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

function bigintOf(field: string, v: unknown): bigint {
  if (typeof v !== "string" || !/^-?\d+$/.test(v)) throw new BoardError(`${field}: expected an integer string`);
  return BigInt(v);
}

function secondsOf(field: string, v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new BoardError(`${field}: expected unix seconds`);
  return v;
}

/** A price's `dayAgo`, or null when it is missing or malformed: it never costs the market its live price. */
function dayAgoOf(v: unknown): BoardDayAgo | null {
  if (!isObj(v) || typeof v.spot !== "string" || !/^\d+$/.test(v.spot)) return null;
  if (typeof v.at !== "number" || !Number.isSafeInteger(v.at) || v.at <= 0) return null;
  const spot = BigInt(v.spot);
  return spot > 0n ? { spot, at: v.at } : null;
}

/** A listing's `day`, or null when it is missing or malformed. */
function dayOf(v: unknown): BoardDay | null {
  if (!isObj(v) || typeof v.volume !== "string" || !/^\d+$/.test(v.volume)) return null;
  const trades = typeof v.trades === "number" && Number.isSafeInteger(v.trades) && v.trades >= 0 ? v.trades : 0;
  return { volume: BigInt(v.volume), trades };
}

const countOf = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

/** The document's `chains`, as the subgraph of each chain that has one. Anything malformed is left out. */
function subgraphsOf(chains: unknown): Map<number, BoardSubgraph> {
  const out = new Map<number, BoardSubgraph>();
  if (!Array.isArray(chains)) return out;
  for (const c of chains) {
    if (!isObj(c) || typeof c.chainId !== "number" || !isObj(c.subgraph)) continue;
    const s = c.subgraph;
    out.set(c.chainId, {
      reachable: s.reachable === true,
      blocksBehind: countOf(s.blocksBehind),
      secondsBehind: countOf(s.secondsBehind),
      hasIndexingErrors: s.hasIndexingErrors === true,
      checkedAt: countOf(s.checkedAt),
    });
  }
  return out;
}

/** Parse /board.json. A malformed market is skipped; a malformed document throws BoardError. */
export function parseBoard(doc: unknown): Board {
  if (!isObj(doc)) throw new BoardError("the board is not a JSON object");
  const generatedAt = secondsOf("generatedAt", doc.generatedAt);
  if (!isObj(doc.markets)) throw new BoardError("markets: expected an object");
  const out = new Map<string, BoardMarket>();
  for (const [key, raw] of Object.entries(doc.markets)) {
    if (!isObj(raw)) continue;
    try {
      const feedId = key.toLowerCase() as Hex;
      const listings = Array.isArray(raw.listings)
        ? raw.listings.filter(isObj).flatMap((l) =>
            typeof l.chainId === "number" && typeof l.pair === "string" && /^0x[0-9a-fA-F]{40}$/.test(l.pair)
              ? [{ chainId: l.chainId, pair: l.pair as Address, day: dayOf(l.day) }]
              : [],
          )
        : [];
      let price: BoardPrice | null = null;
      if (isObj(raw.price)) {
        price = {
          spot: bigintOf(`${key}.price.spot`, raw.price.spot),
          low: bigintOf(`${key}.price.low`, raw.price.low),
          high: bigintOf(`${key}.price.high`, raw.price.high),
          publishTime: secondsOf(`${key}.price.publishTime`, raw.price.publishTime),
          confidenceOk: raw.price.confidenceOk !== false,
          dayAgo: dayAgoOf(raw.price.dayAgo),
        };
        if (price.spot <= 0n) price = null;
      }
      out.set(feedId, { feedId, label: typeof raw.label === "string" ? raw.label : "", continuous: raw.continuous !== false, listings, price });
    } catch {
      // One bad entry must not hide every other market's price.
    }
  }
  return { version: typeof doc.version === "number" ? doc.version : 0, generatedAt, markets: out, subgraphs: subgraphsOf(doc.chains) };
}

/**
 * The board as the SDK's LivePriceView, for one chain. Pairs are found through the board's own
 * listings, and through `feedOf` (the SDK's MarketInfo.baseFeedId) for a pair the board lists under
 * another chain or not yet.
 */
export class BoardPrices implements mk.LivePriceView {
  private readonly byPair = new Map<string, BoardMarket>();

  constructor(
    readonly board: Board,
    readonly chainId: number,
    private readonly feedOf: (pair: Address) => Hex | undefined = () => undefined,
  ) {
    for (const m of board.markets.values()) {
      for (const l of m.listings) if (l.chainId === chainId) this.byPair.set(l.pair.toLowerCase(), m);
    }
  }

  /** The board's entry for a pair, or null (a settling or terminated market is left off the board). */
  entry(pair: Address): BoardMarket | null {
    const hit = this.byPair.get(pair.toLowerCase());
    if (hit) return hit;
    const feed = this.feedOf(pair);
    return feed ? (this.board.markets.get(feed.toLowerCase()) ?? null) : null;
  }

  price(pair: Address): mk.LivePriceQuote | null {
    const p = this.entry(pair)?.price;
    return p ? { spot: p.spot, low: p.low, high: p.high, publishTime: p.publishTime } : null;
  }

  /**
   * A trading-hours market whose last price is more than VENUE_CLOSED_AFTER seconds older than the
   * board itself. A 24/7 market, or one the board does not list, is never judged closed here.
   */
  venueClosed(pair: Address): boolean {
    const m = this.entry(pair);
    if (!m || m.continuous || !m.price) return false;
    return this.board.generatedAt - m.price.publishTime > mk.VENUE_CLOSED_AFTER;
  }

  /** The pair's price about 24 hours ago, from Pyth's history; null when the board has none. */
  dayAgo(pair: Address): bigint | null {
    return this.entry(pair)?.price?.dayAgo?.spot ?? null;
  }

  /** The pair's trading over the last 24 hours on this chain, as the service read it; null when the board has none. */
  day(pair: Address): BoardDay | null {
    const lc = pair.toLowerCase();
    return this.entry(pair)?.listings.find((l) => l.chainId === this.chainId && l.pair.toLowerCase() === lc)?.day ?? null;
  }

  /**
   * This chain's subgraph as the service last found it, or null when the service reads no history for
   * the chain (or does not publish it): the page then reads the day's stats and the lag itself.
   */
  subgraph(): BoardSubgraph | null {
    return this.board.subgraphs.get(this.chainId) ?? null;
  }

  /** The spot alone, for the reads that take a single bigint (insurance quotes and budget). */
  spot(pair: Address): bigint | null {
    return this.entry(pair)?.price?.spot ?? null;
  }

  /** Whether Pyth's confidence is within what the oracle accepts. Null without a price. */
  confidenceOk(pair: Address): boolean | null {
    const p = this.entry(pair)?.price;
    return p ? p.confidenceOk : null;
  }
}

/**
 * A price's change over 24 hours: against the board's price 24 hours ago (Pyth's history) when it has
 * one, else against `fallbackOpen` (the first hourly trade candle of the day). Null without a price or
 * a reference. `pct` is a display ratio (0.012 is 1.2%); `change` stays exact.
 */
export function dayChange(spot: bigint | null | undefined, dayAgo: bigint | null | undefined, fallbackOpen?: bigint | null): { change: bigint; pct: number } | null {
  const ref = dayAgo && dayAgo > 0n ? dayAgo : fallbackOpen && fallbackOpen > 0n ? fallbackOpen : null;
  if (ref === null || !spot) return null;
  const change = spot - ref;
  return { change, pct: toNumber18(change) / toNumber18(ref) };
}

/** Seconds since a price was generated, never negative. */
export const priceAge = (publishTime: number, nowSeconds: number = Date.now() / 1000) => Math.max(0, Math.floor(nowSeconds - publishTime));

/** Fetch and parse the board. */
export async function fetchBoard(serviceUrl: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<Board> {
  const res = await fetchImpl(`${serviceUrl}/board.json`, { signal, cache: "no-store" });
  if (!res.ok) throw new BoardError(`the price board answered ${res.status}`);
  return parseBoard(await res.json());
}
