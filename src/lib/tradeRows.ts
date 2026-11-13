/**
 * An account's fills as its trade history shows them: its side, role, fee and order, with the profit or
 * loss each closed, matched from the position changes of the same transaction. A maker's position
 * changes once per fill, a taker's once per order (its walk is applied at the end), so where a
 * transaction has as many changes as fills they pair one to one, and otherwise the order as a whole
 * carries the total. Grouped, the fills of one order become one row at their average price.
 */
import type { history } from "@liberta-labs/bazaar-sdk";
import type { Address, Hex } from "viem";
import { txPairKey } from "./fundingHistory";

export interface TradeRow {
  readonly key: string;
  readonly pair: Address;
  readonly timestamp: number;
  readonly transactionHash: Hex;
  readonly buy: boolean;
  readonly maker: boolean;
  readonly size: bigint;
  /** The fill's price, or the fills' average. */
  readonly price: bigint;
  readonly notional: bigint;
  readonly fee: bigint;
  /** This account's order; null for a vault fill's taker side, which has none. */
  readonly orderId: bigint | null;
  readonly fills: number;
  /** Price P&L the row closed; null when its transaction's changes can't be told apart per fill. */
  readonly closedPnl: bigint | null;
  /** The position once the row was applied; null when not known for this row alone. */
  readonly after: { readonly isLong: boolean; readonly size: bigint } | null;
}

type Change = Pick<history.PositionChange, "pair" | "transactionHash" | "logIndex" | "realizedPnl" | "isLong" | "newSize">;

export function tradeRows(user: Address, trades: readonly history.Trade[], changes: readonly Change[], grouped: boolean): TradeRow[] {
  const me = user.toLowerCase();
  const changesByTx = new Map<string, Change[]>();
  for (const c of changes) {
    const k = txPairKey(c.transactionHash, c.pair);
    changesByTx.set(k, [...(changesByTx.get(k) ?? []), c]);
  }
  for (const list of changesByTx.values()) list.sort((a, b) => a.logIndex - b.logIndex);

  const fills: (TradeRow & { tx: string; logIndex: number })[] = trades.map((t) => {
    const maker = t.maker.toLowerCase() === me;
    return {
      key: t.id,
      tx: txPairKey(t.transactionHash, t.pair),
      logIndex: t.logIndex,
      pair: t.pair,
      timestamp: t.timestamp,
      transactionHash: t.transactionHash,
      buy: maker ? !t.takerIsLong : t.takerIsLong,
      maker,
      size: t.size,
      price: t.price,
      notional: t.notional,
      fee: maker ? t.makerFee : t.takerFee,
      orderId: maker ? t.makerOrderId : t.takerOrderId,
      fills: 1,
      closedPnl: null,
      after: null,
    };
  });

  // Pair each transaction's fills with its changes.
  const fillsByTx = new Map<string, typeof fills>();
  for (const f of fills) fillsByTx.set(f.tx, [...(fillsByTx.get(f.tx) ?? []), f]);
  const perFill = new Map<string, Change>();
  const perOrder = new Map<string, Change[]>();
  for (const [tx, fs] of fillsByTx) {
    const cs = changesByTx.get(tx) ?? [];
    const ordered = [...fs].sort((a, b) => a.logIndex - b.logIndex);
    if (cs.length === ordered.length) ordered.forEach((f, i) => perFill.set(f.key, cs[i]!));
    else if (new Set(ordered.map((f) => `${f.orderId}-${f.maker}`)).size === 1) perOrder.set(tx, cs);
  }

  if (!grouped) {
    return fills.map(({ tx: _tx, logIndex: _li, ...f }) => {
      const c = perFill.get(f.key);
      return c ? { ...f, closedPnl: c.realizedPnl, after: { isLong: c.isLong, size: c.newSize } } : f;
    });
  }

  const groups = new Map<string, typeof fills>();
  for (const f of fills) {
    const g = `${f.tx}-${f.orderId}-${f.maker}`;
    groups.set(g, [...(groups.get(g) ?? []), f]);
  }
  const out: TradeRow[] = [];
  for (const fs of groups.values()) {
    const size = fs.reduce((s, f) => s + f.size, 0n);
    const notional = fs.reduce((s, f) => s + f.notional, 0n);
    const paired = fs.map((f) => perFill.get(f.key));
    const whole = perOrder.get(fs[0]!.tx);
    const cs = paired.every((c) => c !== undefined) ? (paired as Change[]) : whole ?? null;
    const last = cs ? [...cs].sort((a, b) => a.logIndex - b.logIndex)[cs.length - 1] : undefined;
    const head = fs[0]!;
    out.push({
      key: head.key,
      pair: head.pair,
      timestamp: head.timestamp,
      transactionHash: head.transactionHash,
      buy: head.buy,
      maker: head.maker,
      size,
      price: size > 0n ? (notional * 10n ** 18n) / size : head.price,
      notional,
      fee: fs.reduce((s, f) => s + f.fee, 0n),
      orderId: head.orderId,
      fills: fs.length,
      closedPnl: cs ? cs.reduce((s, c) => s + c.realizedPnl, 0n) : null,
      after: last ? { isLong: last.isLong, size: last.newSize } : null,
    });
  }
  return out.sort((a, b) => b.timestamp - a.timestamp);
}
