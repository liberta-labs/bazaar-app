import { describe, expect, it } from "vitest";
import { describeChange, pnlOver } from "../src/lib/trader";

const E = 10n ** 18n;
const DAY = 86_400;

describe("describeChange", () => {
  const c = (isLong: boolean, sizeDelta: bigint, newSize: bigint, realizedPnl = 0n) => describeChange({ isLong, sizeDelta, newSize, realizedPnl });

  it("names opening, adding, reducing and closing, with the size that traded", () => {
    expect(c(true, 2n * E, 2n * E)).toEqual({ action: "Open long", long: true, traded: 2n * E });
    expect(c(false, 1n * E, 3n * E)).toEqual({ action: "Add to short", long: false, traded: 1n * E });
    expect(c(true, -1n * E, 1n * E, 5n * E)).toEqual({ action: "Reduce long", long: true, traded: 1n * E });
    expect(c(false, -3n * E, 0n, -2n * E)).toEqual({ action: "Close short", long: false, traded: 3n * E });
  });

  it("calls an increase that realized profit or loss a flip, and counts both sides as traded", () => {
    // Long 1 to short 2: the size grows by 1, but 3 changed hands, and closing the long realized PnL.
    expect(c(false, 1n * E, 2n * E, 4n * E)).toEqual({ action: "Flip to short", long: false, traded: 3n * E });
  });
});

describe("pnlOver", () => {
  const now = 20_000 * DAY + 3_600;
  const day = (d: number, pnl: bigint, fees = 0n) => ({ date: d * DAY, realizedPnl: pnl * E, feesPaid: fees * E });
  const days = [day(19_900, 50n, 1n), day(19_995, -20n, 2n), day(20_000, 10n, 1n)];

  it("totals realized profit and loss after fees over the period, today counting as a day", () => {
    expect(pnlOver(days, 1, now).total).toBe(9n * E);
    expect(pnlOver(days, 7, now).total).toBe((9n - 22n) * E);
    expect(pnlOver(days, null, now).total).toBe((49n - 22n + 9n) * E);
  });

  it("draws a running total from zero at the period's start, and a flat line for a quiet period", () => {
    expect(pnlOver(days, 7, now).points.map((p) => p.v / E)).toEqual([0n, -22n, -13n]);
    expect(pnlOver(days, 7, now).points[0]!.t).toBe((20_000 - 6) * DAY);
    expect(pnlOver([], 30, now).points.map((p) => p.v)).toEqual([0n, 0n]);
  });
});
