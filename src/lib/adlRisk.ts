/**
 * Where a position stands in the auto-deleveraging queue (the protocol's adl.md). When the insurance
 * fund can't cover the loss on liquidated positions the vault holds, ADL closes profitable positions on
 * the other side against them, ranked by score = profit ÷ collateral, through a 10-minute auction whose
 * bar falls from 25× to zero: the highest scores qualify first. The score is the SDK's own formula on
 * the position's live numbers; nothing here reads the chain.
 */
import { ADL_AUCTION_DURATION, ADL_MAX_SCORE, BAZAAR_SCALE, adlScore, adlThreshold, toNumber18 } from "@liberta-labs/bazaar-sdk";

export type AdlBars = 0 | 1 | 2 | 3 | 4 | 5;

/** From here (9×, four bars) a position exposed to ADL gets a warning: it would qualify in the auction's first 4 minutes. */
export const ADL_WARN_SCORE = 9n * BAZAAR_SCALE;
/** What the warning's remedies aim under (4×, two bars): qualifying only in the auction's last 4 minutes. */
export const ADL_SAFE_SCORE = 4n * BAZAAR_SCALE;

/**
 * Five bars, each 2 minutes earlier in the 10-minute auction: none out of profit, then under 1×, 4×,
 * 9×, 16×, and 16× or more. The bar falls with the square of the time left, so square scores are where
 * the minutes fall.
 */
export function adlBars(score: bigint): AdlBars {
  if (score <= 0n) return 0;
  if (score < BAZAAR_SCALE) return 1;
  if (score < 4n * BAZAAR_SCALE) return 2;
  if (score < 9n * BAZAAR_SCALE) return 3;
  if (score < 16n * BAZAAR_SCALE) return 4;
  return 5;
}

/** Seconds into the auction from which a score qualifies (0 at 25× or more); null out of profit, which never does. */
export function adlQualifiesAfter(score: bigint): number | null {
  if (score <= 0n) return null;
  const share = Math.min(1, toNumber18(score) / toNumber18(ADL_MAX_SCORE));
  return Math.round(ADL_AUCTION_DURATION * (1 - Math.sqrt(share)));
}

export interface AdlRisk {
  /** Profit over collateral, BAZAAR precision (1e18 = 1×); 0 out of profit. */
  readonly score: bigint;
  readonly bars: AdlBars;
  readonly qualifiesAfter: number | null;
  /** The liquidated positions ADL would close this one against: the other side's. */
  readonly against: "longs" | "shorts";
  /** The vault holds some: without them ADL cannot reach the position. */
  readonly exposed: boolean;
  /** ADL is running on the market now. */
  readonly running: boolean;
  /** While it runs: the position clears the auction's bar now. */
  readonly qualifiesNow: boolean;
}

/**
 * The position's ADL standing. Deposits made while a window is open don't count toward the score; they
 * aren't known here, so during a window a position topped up mid-window ranks higher than this says.
 */
export function adlRisk(
  position: { readonly isLong: boolean; readonly collateral: bigint },
  totalPnl: bigint,
  state: { readonly adlPending: boolean; readonly adlAuctionStart: number; readonly longInv: { readonly size: bigint }; readonly shortInv: { readonly size: bigint } },
  now: number,
): AdlRisk {
  const score = adlScore(totalPnl, position.collateral, 0n);
  // Profitable longs close the liquidated shorts, profitable shorts the liquidated longs.
  const other = position.isLong ? state.shortInv : state.longInv;
  const exposed = other.size > 0n;
  const running = state.adlPending;
  return {
    score,
    bars: adlBars(score),
    qualifiesAfter: adlQualifiesAfter(score),
    against: position.isLong ? "shorts" : "longs",
    exposed,
    running,
    qualifiesNow: running && exposed && score > 0n && score >= adlThreshold(state.adlAuctionStart, now),
  };
}

/**
 * What brings the score under `target`: collateral to add, or how much of the position to close, which
 * moves that share of the profit into collateral. Each with a margin for fees and the price moving. Null
 * when the score is already under.
 */
export function adlRemedy(totalPnl: bigint, collateral: bigint, size: bigint, target: bigint = ADL_SAFE_SCORE): { addCollateral: bigint; closeSize: bigint } | null {
  if (totalPnl <= 0n || size <= 0n || adlScore(totalPnl, collateral, 0n) < target) return null;
  // P / (C + X) < T  when  X > P/T − C.
  const need = (totalPnl * BAZAAR_SCALE) / target - collateral;
  const addCollateral = need + need / 100n + 1n;
  // Closing a share f leaves (1 − f)·P of profit on C + f·P of collateral, under T when f > (P − T·C) / (P·(1 + T)).
  const num = totalPnl * BAZAAR_SCALE - target * collateral;
  const den = totalPnl * (BAZAAR_SCALE + target);
  let closeSize = (size * num + den - 1n) / den;
  closeSize += closeSize / 50n;
  if (closeSize > size) closeSize = size;
  return { addCollateral, closeSize };
}

/** A score as people read it: "12.3×", "0.42×", "100×+". */
export function scoreText(score: bigint): string {
  const x = toNumber18(score);
  if (x >= 100) return "100×+";
  return `${x.toFixed(x < 10 ? 2 : 1)}×`;
}
