/**
 * Your own orders and position on a market, as lines across its price chart, the way trading apps
 * draw them: a dashed line per resting order at its limit (green buys, red sells), a dotted line per
 * order still waiting on its trigger (stop-limits not yet armed, take-profit, stop-loss), a solid line
 * at the position's entry, and its liquidation price.
 */
import type { account } from "@liberta-labs/bazaar-sdk";
import { sizeText } from "./format";

export interface ChartMark {
  /** Stays the same while the line does, so the chart moves a line rather than redrawing it. */
  readonly key: string;
  readonly price: bigint;
  readonly tone: "up" | "down" | "neutral" | "warn";
  readonly style: "solid" | "dashed" | "dotted";
  /** Beside the line at the price axis: "Buy 0.0028", "TP", "Liq.". */
  readonly title: string;
}

interface Group {
  price: bigint;
  tone: ChartMark["tone"];
  style: ChartMark["style"];
  label: string;
  size: bigint;
  /** A TP/SL that closes the whole position, whatever its size then: no size to show. */
  whole: boolean;
  count: number;
}

/**
 * The lines for one market's account snapshot, with the position's liquidation price when it has one.
 * Orders on the same side at the same price share one line, its size the sum ("Buy 0.0056 (2)").
 */
export function chartMarks(s: account.AccountSnapshot | undefined, liquidation: bigint | null): ChartMark[] {
  if (!s) return [];
  const groups = new Map<string, Group>();
  const add = (key: string, g: Omit<Group, "count" | "size" | "whole">, size: bigint, whole: boolean) => {
    const cur = groups.get(key);
    if (cur) {
      cur.size += size;
      cur.whole ||= whole;
      cur.count++;
    } else groups.set(key, { ...g, size, whole, count: 1 });
  };

  for (const o of s.orders) {
    const side = o.isLong ? "Buy" : "Sell";
    const tone = o.isLong ? "up" : "down";
    if (o.typeName === "Limit" || (o.typeName === "StopLimit" && o.inBook)) {
      if (o.limitPrice > 0n) add(`limit:${side}:${o.limitPrice}`, { price: o.limitPrice, tone, style: "dashed", label: side }, o.remaining, false);
    } else if (o.typeName === "StopLimit") {
      if (o.triggerPrice > 0n) add(`stop:${side}:${o.triggerPrice}`, { price: o.triggerPrice, tone, style: "dotted", label: `Stop ${side.toLowerCase()}` }, o.remaining, false);
    } else if (o.typeName === "TakeProfit" || o.typeName === "StopLoss") {
      const tp = o.typeName === "TakeProfit";
      if (o.triggerPrice > 0n) add(`${tp ? "tp" : "sl"}:${o.triggerPrice}`, { price: o.triggerPrice, tone: tp ? "up" : "down", style: "dotted", label: tp ? "TP" : "SL" }, o.remaining, o.closesWholePosition);
    }
  }

  const marks: ChartMark[] = [...groups].map(([key, g]) => ({
    key,
    price: g.price,
    tone: g.tone,
    style: g.style,
    title: [g.label, g.whole ? null : sizeText(g.size), g.count > 1 ? `(${g.count})` : null].filter(Boolean).join(" "),
  }));

  if (s.hasPosition && s.position.size > 0n) {
    marks.push({ key: "entry", price: s.position.entryPrice, tone: "neutral", style: "solid", title: `${s.position.isLong ? "Long" : "Short"} ${sizeText(s.position.size)}` });
    if (liquidation !== null && liquidation > 0n) marks.push({ key: "liq", price: liquidation, tone: "warn", style: "dashed", title: "Liq." });
  }
  return marks;
}
