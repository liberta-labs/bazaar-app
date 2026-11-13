import { BAZAAR_SCALE } from "@liberta-labs/bazaar-sdk";
import { describe, expect, it } from "vitest";
import { fundingPayments, txPairKey } from "../src/lib/fundingHistory";
import { mergeByTime } from "../src/lib/mergePages";
import { tradeRows } from "../src/lib/tradeRows";

const X = BAZAAR_SCALE;
const PAIR = "0x41C5F5f49f49F53a7a7669575d1DE539AE8A6A4E" as const;
const ME = "0x00000000000000000000000000000000000000aa" as const;
const THEM = "0x00000000000000000000000000000000000000bb" as const;

let n = 0;
const snap = (o: { isLong: boolean; size: bigint; entry: bigint; global: bigint; t: number; tx?: string; imrBp?: bigint }) => ({
  id: `0xs${n++}` as `0x${string}`,
  pair: PAIR,
  isLong: o.isLong,
  size: o.size,
  entryFundingIndex: o.entry,
  globalFundingIndex: o.global,
  imrBp: o.imrBp ?? 1000n,
  timestamp: o.t,
  transactionHash: (o.tx ?? `0xt${o.t}`) as `0x${string}`,
  logIndex: 0,
});

describe("fundingPayments", () => {
  it("pays nothing on an open or an add, a slice on a reduce, and the rest on the close", () => {
    // Long 2 units from index 0; the index rises 10 per unit (longs pay), so funding is -20 by t=2.
    const list = [
      snap({ isLong: true, size: 2n * X, entry: 0n, global: 0n, t: 1 }),
      snap({ isLong: true, size: 1n * X, entry: 0n, global: 10n * X, t: 2 }),
      snap({ isLong: true, size: 0n, entry: 0n, global: 30n * X, t: 3 }),
    ];
    const p = fundingPayments(list);
    expect(p.map((x) => [x.timestamp, x.closed, x.amount])).toEqual([
      [3, 1n * X, -30n * X],
      [2, 1n * X, -10n * X],
    ]);
    expect(p.every((x) => x.via === "trade" && x.isLong)).toBe(true);
  });

  it("settles all of it on a flip, and a short receives what a long pays", () => {
    const list = [
      snap({ isLong: false, size: 1n * X, entry: 5n * X, global: 5n * X, t: 1 }),
      snap({ isLong: true, size: 3n * X, entry: 9n * X, global: 9n * X, t: 2 }),
    ];
    const [p] = fundingPayments(list);
    expect(p).toMatchObject({ closed: 1n * X, amount: 4n * X, isLong: false });
  });

  it("skips liquidations and takes withheld funding off an ADL close", () => {
    const list = [
      snap({ isLong: true, size: 2n * X, entry: 0n, global: 0n, t: 1 }),
      snap({ isLong: true, size: 1n * X, entry: 0n, global: -10n * X, t: 2, tx: "0xadl" }),
      snap({ isLong: true, size: 0n, entry: 0n, global: -10n * X, t: 3, tx: "0xliq" }),
    ];
    const p = fundingPayments(list, new Set([txPairKey("0xliq", PAIR)]), new Map([[txPairKey("0xadl", PAIR), 3n * X]]));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ via: "adl", amount: 7n * X });
  });

  it("marks a terminal settlement, and ignores collateral-only snapshots", () => {
    const list = [
      snap({ isLong: true, size: 1n * X, entry: 0n, global: 0n, t: 1 }),
      snap({ isLong: true, size: 1n * X, entry: 0n, global: 2n * X, t: 2 }),
      snap({ isLong: true, size: 0n, entry: 0n, global: 4n * X, t: 3, imrBp: 0n }),
    ];
    const p = fundingPayments(list);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ via: "settlement", amount: -4n * X });
  });
});

describe("mergeByTime", () => {
  const src = (times: number[]) => async ({ first, to }: { first: number; to?: number }) => {
    const items = times.filter((t) => to === undefined || t < to).sort((a, b) => b - a);
    return { items: items.slice(0, first).map((timestamp) => ({ timestamp, from: times })), next: items.length > first ? "more" : null };
  };

  it("pages several lists as one, newest first, missing and repeating nothing", async () => {
    const a = [100, 90, 80, 70, 60, 50];
    const b = [95, 85, 75, 74, 73, 10];
    const load = mergeByTime([src(a), src(b)]);
    const seen: number[] = [];
    let after: string | null = null;
    for (let i = 0; i < 20; i++) {
      const p: { items: { timestamp: number }[]; next: string | null } = await load({ first: 2, after });
      seen.push(...p.items.map((x) => x.timestamp));
      if (!p.next) break;
      after = p.next;
    }
    expect(seen).toEqual([...a, ...b].sort((x, y) => y - x));
  });
});

describe("tradeRows", () => {
  const trade = (o: { id: string; tx: string; log: number; maker: string; taker: string; takerIsLong: boolean; size: bigint; price: bigint; makerOrderId?: bigint; takerOrderId?: bigint }) => ({
    id: o.id as `0x${string}`,
    pair: PAIR,
    maker: o.maker as `0x${string}`,
    taker: o.taker as `0x${string}`,
    isVaultFill: false,
    takerIsLong: o.takerIsLong,
    makerOrderId: o.makerOrderId ?? 1n,
    takerOrderId: o.takerOrderId ?? 2n,
    size: o.size,
    price: o.price,
    notional: (o.size * o.price) / X,
    makerFee: 1n,
    takerFee: 3n,
    makerRemaining: 0n,
    takerRemaining: 0n,
    makerIntegrator: "0x0000000000000000000000000000000000000000" as const,
    takerIntegrator: "0x0000000000000000000000000000000000000000" as const,
    txFrom: o.taker as `0x${string}`,
    blockNumber: 1,
    timestamp: 100,
    transactionHash: o.tx as `0x${string}`,
    logIndex: o.log,
  });
  const change = (tx: string, log: number, pnl: bigint, newSize: bigint) => ({ pair: PAIR, transactionHash: tx as `0x${string}`, logIndex: log, realizedPnl: pnl, isLong: true, newSize });

  it("pairs a maker's fills one to one with its changes", () => {
    const trades = [
      trade({ id: "a", tx: "0x1", log: 1, maker: ME, taker: THEM, takerIsLong: true, size: X, price: 10n * X }),
      trade({ id: "b", tx: "0x1", log: 3, maker: ME, taker: THEM, takerIsLong: true, size: X, price: 11n * X, makerOrderId: 7n }),
    ];
    const rows = tradeRows(ME, trades, [change("0x1", 2, 5n, 4n * X), change("0x1", 4, 6n, 3n * X)], false);
    expect(rows.map((r) => [r.key, r.buy, r.maker, r.fee, r.closedPnl, r.after?.size])).toEqual([
      ["a", false, true, 1n, 5n, 4n * X],
      ["b", false, true, 1n, 6n, 3n * X],
    ]);
  });

  it("gives a taker's order its one change as a whole, and groups its fills at the average price", () => {
    const trades = [
      trade({ id: "a", tx: "0x2", log: 1, maker: THEM, taker: ME, takerIsLong: false, size: X, price: 10n * X }),
      trade({ id: "b", tx: "0x2", log: 2, maker: THEM, taker: ME, takerIsLong: false, size: 3n * X, price: 14n * X }),
    ];
    const changes = [change("0x2", 9, -40n, 0n)];
    expect(tradeRows(ME, trades, changes, false).every((r) => r.closedPnl === null)).toBe(true);
    const [g] = tradeRows(ME, trades, changes, true);
    expect(g).toMatchObject({ fills: 2, size: 4n * X, price: 13n * X, fee: 6n, closedPnl: -40n, buy: false, maker: false, orderId: 2n });
    expect(g!.after).toEqual({ isLong: true, size: 0n });
  });
});
