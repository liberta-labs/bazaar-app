import { describe, expect, it } from "vitest";
import { MAX_DEFER_MS, MAX_SETTLE_MS, MIN_SETTLE_MS, reloadIn, reloadSize, settleMs } from "../src/lib/historySync";

describe("settleMs", () => {
  it("waits for the subgraph's trail plus a margin, within bounds", () => {
    expect(settleMs(5)).toBe(9_000);
    expect(settleMs(20)).toBe(24_000);
    expect(settleMs(0)).toBe(MIN_SETTLE_MS);
    expect(settleMs(600)).toBe(MAX_SETTLE_MS);
  });

  it("assumes the usual trail when the board does not say, or says something impossible", () => {
    for (const lag of [null, Number.NaN, -3, Number.POSITIVE_INFINITY]) expect(settleMs(lag)).toBe(9_000);
  });
});

describe("reloadIn", () => {
  it("waits a full settle after each change of a burst", () => {
    expect(reloadIn(1_000, 1_000, 9_000)).toBe(9_000);
    expect(reloadIn(4_000, 1_000, 9_000)).toBe(9_000);
  });

  it("holds a run of changes back no longer than the deferral past the first change's wait", () => {
    const since = 0;
    const settle = 9_000;
    expect(reloadIn(30_000, since, settle)).toBe(9_000);
    expect(reloadIn(35_000, since, settle)).toBe(settle + MAX_DEFER_MS - 35_000);
    expect(reloadIn(since + settle + MAX_DEFER_MS + 5, since, settle)).toBe(0);
  });
});

describe("reloadSize", () => {
  it("asks for as many rows as are shown, at least a page and at most the subgraph's limit", () => {
    expect(reloadSize(0, 50)).toBe(50);
    expect(reloadSize(30, 50)).toBe(50);
    expect(reloadSize(150, 50)).toBe(150);
    expect(reloadSize(4_000, 50)).toBe(1_000);
  });
});
