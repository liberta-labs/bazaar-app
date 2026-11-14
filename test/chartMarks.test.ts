import type { account } from "@liberta-labs/bazaar-sdk";
import { describe, expect, it } from "vitest";
import { chartMarks } from "../src/lib/chartMarks";

const usd = (n: number) => BigInt(Math.round(n * 100)) * 10n ** 16n;
const btc = (n: number) => BigInt(Math.round(n * 1e8)) * 10n ** 10n;

let id = 0n;
const order = (o: Partial<account.AccountOrder>) =>
  ({ orderId: ++id, typeName: "Limit", isLong: true, remaining: btc(0.001), limitPrice: 0n, triggerPrice: 0n, inBook: true, closesWholePosition: false, ...o }) as account.AccountOrder;

const snap = (orders: account.AccountOrder[], position?: { isLong: boolean; size: bigint; entryPrice: bigint }) =>
  ({ orders, hasPosition: !!position, position: position ?? { isLong: true, size: 0n, entryPrice: 0n } }) as unknown as account.AccountSnapshot;

const brief = (marks: ReturnType<typeof chartMarks>) => marks.map((m) => `${m.title} @${Number(m.price / 10n ** 16n) / 100} ${m.tone} ${m.style}`);

describe("chartMarks", () => {
  it("draws nothing without an account on the market", () => {
    expect(chartMarks(undefined, null)).toEqual([]);
    expect(chartMarks(snap([]), null)).toEqual([]);
  });

  it("draws resting orders dashed at their limit, green buys and red sells", () => {
    const marks = chartMarks(snap([order({ limitPrice: usd(67_000), remaining: btc(0.0028) }), order({ isLong: false, limitPrice: usd(69_500), remaining: btc(0.5) })]), null);
    expect(brief(marks)).toEqual(["Buy 0.0028 @67000 up dashed", "Sell 0.5 @69500 down dashed"]);
  });

  it("puts orders on the same side at one price on one line, sizes summed", () => {
    const marks = chartMarks(snap([order({ limitPrice: usd(67_000) }), order({ limitPrice: usd(67_000), remaining: btc(0.002) }), order({ isLong: false, limitPrice: usd(67_000) })]), null);
    expect(brief(marks)).toEqual(["Buy 0.003 (2) @67000 up dashed", "Sell 0.001 @67000 down dashed"]);
  });

  it("draws a stop-limit dotted at its trigger until it arms, then at its limit like any resting order", () => {
    const waiting = order({ typeName: "StopLimit", inBook: false, triggerPrice: usd(70_000), limitPrice: usd(70_100) });
    const armed = order({ typeName: "StopLimit", inBook: true, triggerPrice: usd(70_000), limitPrice: usd(70_100) });
    expect(brief(chartMarks(snap([waiting]), null))).toEqual(["Stop buy 0.001 @70000 up dotted"]);
    expect(brief(chartMarks(snap([armed]), null))).toEqual(["Buy 0.001 @70100 up dashed"]);
  });

  it("labels take-profit and stop-loss by what they do, with no size when they close the whole position", () => {
    const marks = chartMarks(
      snap([
        order({ typeName: "TakeProfit", isLong: false, triggerPrice: usd(75_000), closesWholePosition: true }),
        order({ typeName: "StopLoss", isLong: false, triggerPrice: usd(62_000), remaining: btc(0.01) }),
      ]),
      null,
    );
    expect(brief(marks)).toEqual(["TP @75000 up dotted", "SL 0.01 @62000 down dotted"]);
  });

  it("draws the position's entry solid and its liquidation price", () => {
    const marks = chartMarks(snap([], { isLong: false, size: btc(0.072094), entryPrice: usd(66_900) }), usd(80_123.45));
    expect(brief(marks)).toEqual(["Short 0.07209 @66900 neutral solid", "Liq. @80123.45 warn dashed"]);
    expect(chartMarks(snap([], { isLong: true, size: btc(1), entryPrice: usd(66_900) }), null).map((m) => m.key)).toEqual(["entry"]);
  });

  it("keeps a line's key while only its size changes, so the chart moves it rather than redrawing it", () => {
    const a = chartMarks(snap([order({ limitPrice: usd(67_000) })]), null);
    const b = chartMarks(snap([order({ limitPrice: usd(67_000), remaining: btc(0.0005) })]), null);
    expect(a[0]!.key).toBe(b[0]!.key);
    expect(a[0]!.title).not.toBe(b[0]!.title);
  });
});
