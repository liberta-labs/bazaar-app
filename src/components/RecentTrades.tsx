/**
 * The market's latest fills: from the subgraph, with live fills from the market's watch put on top.
 * Columns: time (click to sort newest or oldest first), price, size (click to show it in the asset or
 * in USDC). Both choices are remembered in this browser.
 */
import type { history } from "@liberta-labs/bazaar-sdk";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { price, sizeText, usd } from "../lib/format";
import { useActivity } from "../state/activity";
import { useRead } from "../state/connection";
import { Empty, Loading, TxLink } from "./ui";

export interface LiveFill {
  readonly key: string;
  readonly price: bigint;
  readonly size: bigint;
  /** The taker's side: a buy lifted an ask. */
  readonly buy: boolean;
  /** Unix seconds. */
  readonly time: number;
  readonly hash: string;
}

const SHOWN = 40;
const E18 = 10n ** 18n;

type SizeUnit = "asset" | "usdc";
type Order = "desc" | "asc";

/** A remembered choice; the default when storage is unavailable or holds something else. */
function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

export function RecentTrades({ pair, live, base = "asset" }: { pair: Address; live: readonly LiveFill[]; base?: string }) {
  const { readBz } = useRead();
  // Fills that landed during a pause were not seen live: read the list again on the way back.
  const { resumes } = useActivity();
  const [rows, setRows] = useState<LiveFill[] | null>(null);
  const [unit, setUnit] = useState<SizeUnit>(() => remembered("bazaar.trades.size", ["asset", "usdc"], "asset"));
  const [order, setOrder] = useState<Order>(() => remembered("bazaar.trades.order", ["desc", "asc"], "desc"));
  useEffect(() => {
    if (!readBz) return;
    let dead = false;
    readBz.history
      .trades({ pair, first: SHOWN })
      .then((p) => {
        if (!dead) setRows(p.items.map((t: history.Trade) => ({ key: t.id, price: t.price, size: t.size, buy: t.takerIsLong, time: t.timestamp, hash: t.transactionHash })));
      })
      .catch(() => !dead && setRows([]));
    return () => {
      dead = true;
    };
  }, [readBz, pair, resumes]);
  if (rows === null && !live.length) return <Loading />;
  const seen = new Set<string>();
  // The latest SHOWN fills, newest first; then in the order asked for. A stable sort keeps fills of the
  // same second in the order they arrived.
  const latest = [...live, ...(rows ?? [])]
    .filter((r) => (seen.has(r.hash + r.price + r.size) ? false : (seen.add(r.hash + r.price + r.size), true)))
    .sort((a, b) => b.time - a.time)
    .slice(0, SHOWN);
  const all = order === "desc" ? latest : [...latest].reverse();
  if (!all.length) return <Empty title="No trades yet">Fills show here as they happen.</Empty>;

  const flipUnit = () => {
    const next = unit === "asset" ? "usdc" : "asset";
    setUnit(next);
    remember("bazaar.trades.size", next);
  };
  const flipOrder = () => {
    const next = order === "desc" ? "asc" : "desc";
    setOrder(next);
    remember("bazaar.trades.order", next);
  };

  return (
    <div className="book trades">
      <div className="book-row muted" style={{ cursor: "default" }}>
        <span>
          <button
            className="th-btn"
            onClick={flipOrder}
            title={order === "desc" ? "Newest first. Click for oldest first." : "Oldest first. Click for newest first."}
            aria-label={`Time, ${order === "desc" ? "newest" : "oldest"} first. Change the order.`}
          >
            Time {order === "desc" ? "↓" : "↑"}
          </button>
        </span>
        <span>Price</span>
        <span>
          <button
            className="th-btn"
            onClick={flipUnit}
            title={unit === "asset" ? `Size in ${base}. Click to show it in USDC.` : `Size in USDC. Click to show it in ${base}.`}
            aria-label={`Size in ${unit === "asset" ? base : "USDC"}. Show it in ${unit === "asset" ? "USDC" : base}.`}
          >
            Size ({unit === "asset" ? base : "USDC"}) ⇄
          </button>
        </span>
      </div>
      {all.map((r) => (
        <div key={r.key} className="book-row" style={{ cursor: "default" }}>
          <span>
            <TxLink hash={r.hash}>{new Date(r.time * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</TxLink>
          </span>
          <span className={r.buy ? "up" : "down"}>{price(r.price)}</span>
          <span>{unit === "asset" ? sizeText(r.size) : usd((r.size * r.price) / E18)}</span>
        </div>
      ))}
    </div>
  );
}
