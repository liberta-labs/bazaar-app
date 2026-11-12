/**
 * The price board: the service's /board.json, read every 10 seconds for display, and an adapter that
 * hands it to the SDK as a LivePriceView. The board is the only price source the page has: it holds
 * no Pyth key, and every call that needs a fresh signed price goes through the relayer.
 */
import { markets as mk } from "@liberta-labs/bazaar-sdk";
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
}

export interface BoardMarket {
  /** The base feed id, lowercase: the key the board uses. */
  readonly feedId: Hex;
  readonly label: string;
  readonly continuous: boolean;
  readonly listings: readonly { readonly chainId: number; readonly pair: Address }[];
  /** Null until Pyth has sent a price for every leg. */
  readonly price: BoardPrice | null;
}

export interface Board {
  readonly version: number;
  /** Unix seconds the snapshot was published at. */
  readonly generatedAt: number;
  readonly markets: ReadonlyMap<string, BoardMarket>;
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
            typeof l.chainId === "number" && typeof l.pair === "string" && /^0x[0-9a-fA-F]{40}$/.test(l.pair) ? [{ chainId: l.chainId, pair: l.pair as Address }] : [],
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
        };
        if (price.spot <= 0n) price = null;
      }
      out.set(feedId, { feedId, label: typeof raw.label === "string" ? raw.label : "", continuous: raw.continuous !== false, listings, price });
    } catch {
      // One bad entry must not hide every other market's price.
    }
  }
  return { version: typeof doc.version === "number" ? doc.version : 0, generatedAt, markets: out };
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

/** Seconds since a price was generated, never negative. */
export const priceAge = (publishTime: number, nowSeconds: number = Date.now() / 1000) => Math.max(0, Math.floor(nowSeconds - publishTime));

/** Fetch and parse the board. */
export async function fetchBoard(serviceUrl: string, fetchImpl: typeof fetch = fetch, signal?: AbortSignal): Promise<Board> {
  const res = await fetchImpl(`${serviceUrl}/board.json`, { signal, cache: "no-store" });
  if (!res.ok) throw new BoardError(`the price board answered ${res.status}`);
  return parseBoard(await res.json());
}
