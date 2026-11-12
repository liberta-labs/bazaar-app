import type { markets } from "@liberta-labs/bazaar-sdk";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { price, sizeText, usd } from "../lib/format";
import { useRead } from "../state/connection";
import { Empty, Term } from "./ui";

const LEVELS = 12;

/** The live book, read from the chain, re-read whenever the market's watch reports a change. */
export function OrderBook({ pair, version, mark, onPick }: { pair: Address; version: number; mark: bigint | null; onPick: (p: bigint) => void }) {
  const { readBz } = useRead();
  const [book, setBook] = useState<{ bids: markets.BookDepth; asks: markets.BookDepth } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!readBz) return;
    let dead = false;
    readBz.markets
      .getBook(pair, LEVELS)
      .then((b) => {
        if (!dead) {
          setBook(b);
          setError(false);
        }
      })
      .catch(() => !dead && setError(true));
    return () => {
      dead = true;
    };
  }, [readBz, pair, version]);

  if (!book) return <div className="empty muted small">{error ? "The order book can't be read right now." : "Loading the book…"}</div>;
  // Sizes in USDC: each level's notional (size × price), and the running total from the best level out.
  const withTotals = (levels: readonly markets.DepthLevel[]) => {
    let total = 0n;
    return levels.map((l) => ({ ...l, total: (total += l.notional) }));
  };
  const asks = withTotals(book.asks.levels).reverse();
  const bids = withTotals(book.bids.levels);
  const max = [...asks, ...bids].reduce((m, l) => (l.total > m ? l.total : m), 0n) || 1n;
  const bestBid = bids[0]?.price;
  const bestAsk = book.asks.levels[0]?.price;
  const width = (c: bigint) => `${Number((c * 1000n) / max) / 10}%`;

  if (!asks.length && !bids.length) {
    return <Empty title="The book is empty">Place a limit order to be the first. Market orders need resting orders to fill against.</Empty>;
  }
  return (
    <div className="book" role="table" aria-label="Order book">
      <div className="book-row muted" style={{ cursor: "default" }}>
        <span>Price</span>
        <span>Size (USDC)</span>
        <span>Total (USDC)</span>
      </div>
      {asks.map((l) => (
        <div key={`a${l.price}`} className="book-row ask" onClick={() => onPick(l.price)} title={`${sizeText(l.size)} in the asset. Click to use this price.`}>
          <div className="bar" style={{ width: width(l.total) }} />
          <span className="down">{price(l.price)}</span>
          <span>{usd(l.notional)}</span>
          <span>{usd(l.total)}</span>
        </div>
      ))}
      <div className="book-mid small">
        <span>
          <Term t="mark">Mark</Term> {mark ? price(mark) : "–"}
        </span>
        <span className="muted">{bestBid && bestAsk ? `spread ${price(bestAsk - bestBid)}` : ""}</span>
      </div>
      {bids.map((l) => (
        <div key={`b${l.price}`} className="book-row bid" onClick={() => onPick(l.price)} title={`${sizeText(l.size)} in the asset. Click to use this price.`}>
          <div className="bar" style={{ width: width(l.total) }} />
          <span className="up">{price(l.price)}</span>
          <span>{usd(l.notional)}</span>
          <span>{usd(l.total)}</span>
        </div>
      ))}
    </div>
  );
}
