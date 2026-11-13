import { BAZAAR_SCALE, adlScore } from "@liberta-labs/bazaar-sdk";
import { describe, expect, it } from "vitest";
import { ADL_SAFE_SCORE, adlBars, adlQualifiesAfter, adlRemedy, adlRisk, scoreText } from "../src/lib/adlRisk";

const X = BAZAAR_SCALE;
const usd = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;
const quiet = { adlPending: false, adlAuctionStart: 0, longInv: { size: 0n }, shortInv: { size: 0n } };

describe("adlBars", () => {
  it("lights a bar for each 2 minutes earlier in the auction", () => {
    expect(adlBars(0n)).toBe(0);
    expect(adlBars(1n)).toBe(1);
    expect(adlBars(X - 1n)).toBe(1);
    expect(adlBars(X)).toBe(2);
    expect(adlBars(4n * X - 1n)).toBe(2);
    expect(adlBars(4n * X)).toBe(3);
    expect(adlBars(9n * X)).toBe(4);
    expect(adlBars(16n * X)).toBe(5);
    expect(adlBars(1000n * X)).toBe(5);
  });
});

describe("adlQualifiesAfter", () => {
  it("follows the auction's bar, 25× at the start falling to zero over 10 minutes", () => {
    expect(adlQualifiesAfter(0n)).toBeNull();
    expect(adlQualifiesAfter(25n * X)).toBe(0);
    expect(adlQualifiesAfter(100n * X)).toBe(0);
    expect(adlQualifiesAfter(16n * X)).toBe(120);
    expect(adlQualifiesAfter(9n * X)).toBe(240);
    expect(adlQualifiesAfter(4n * X)).toBe(360);
    expect(adlQualifiesAfter(X)).toBe(480);
    expect(adlQualifiesAfter(1n)).toBe(600);
  });
});

describe("adlRisk", () => {
  it("scores profit over collateral, and nothing out of profit", () => {
    const r = adlRisk({ isLong: true, collateral: usd(100) }, usd(1_200), quiet, 0);
    expect(r.score).toBe(12n * X);
    expect(r.bars).toBe(4);
    expect(r.qualifiesAfter).toBe(Math.round(600 * (1 - Math.sqrt(12 / 25))));
    expect(adlRisk({ isLong: true, collateral: usd(100) }, -usd(50), quiet, 0)).toMatchObject({ score: 0n, bars: 0, qualifiesAfter: null });
  });

  it("is exposed only while the vault holds liquidated positions on the other side", () => {
    const longsHeld = { ...quiet, longInv: { size: X } };
    expect(adlRisk({ isLong: false, collateral: usd(100) }, usd(500), longsHeld, 0)).toMatchObject({ exposed: true, against: "longs" });
    expect(adlRisk({ isLong: true, collateral: usd(100) }, usd(500), longsHeld, 0)).toMatchObject({ exposed: false, against: "shorts" });
  });

  it("qualifies now once the running auction's bar has fallen to its score", () => {
    const running = { ...quiet, adlPending: true, adlAuctionStart: 1_000, shortInv: { size: X } };
    const pos = { isLong: true, collateral: usd(100) };
    // 9× qualifies from 240 s in.
    expect(adlRisk(pos, usd(900), running, 1_000 + 200).qualifiesNow).toBe(false);
    expect(adlRisk(pos, usd(900), running, 1_000 + 250).qualifiesNow).toBe(true);
    // Not exposed, or not running: never now.
    expect(adlRisk(pos, usd(900), { ...running, shortInv: { size: 0n } }, 1_000 + 599).qualifiesNow).toBe(false);
    expect(adlRisk(pos, usd(900), { ...quiet, shortInv: { size: X } }, 1_000 + 599).qualifiesNow).toBe(false);
  });
});

describe("adlRemedy", () => {
  it("finds the collateral, or the share to close, that brings the score under 4×", () => {
    const P = usd(1_200);
    const C = usd(100);
    const size = 10n * X;
    const r = adlRemedy(P, C, size)!;
    expect(adlScore(P, C + r.addCollateral, 0n)).toBeLessThan(ADL_SAFE_SCORE);
    // Closing moves that share of the profit into collateral.
    const realized = (P * r.closeSize) / size;
    expect(adlScore(P - realized, C + realized, 0n)).toBeLessThan(ADL_SAFE_SCORE);
    // And not far past what's needed: 1,200 / 4 − 100 = 200 USDC more collateral, or (1,200 − 400) / (1,200 × 5) ≈ 13.3% of the position.
    expect(r.addCollateral).toBeLessThan(usd(203));
    expect(r.closeSize).toBeGreaterThan((size * 133n) / 1000n);
    expect(r.closeSize).toBeLessThan((size * 14n) / 100n);
  });

  it("asks nothing of a position already under, or out of profit", () => {
    expect(adlRemedy(usd(300), usd(100), X)).toBeNull();
    expect(adlRemedy(-usd(300), usd(100), X)).toBeNull();
  });

  it("closes no more than the whole position", () => {
    expect(adlRemedy(usd(1_000), 0n, X)!.closeSize).toBeLessThanOrEqual(X);
  });
});

describe("scoreText", () => {
  it("reads as a multiple", () => {
    expect(scoreText((42n * X) / 100n)).toBe("0.42×");
    expect(scoreText((123n * X) / 10n)).toBe("12.3×");
    expect(scoreText(500n * X)).toBe("100×+");
  });
});
