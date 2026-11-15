/**
 * An estimated return for insuring a market: the insurance fund's share of the trailing window's
 * trading fees over the fund's value, annualized; and the net return, the share price's change annualized,
 * which also counts what the fund paid out (liquidation losses beyond maintenance margin, ADL) and
 * levies. Past performance only.
 *
 * The subgraph's fee figures carry both legs of each fill's fee (insurance and integrator), and the
 * pair skims 1% of each leg to the bug bounty (protocol/fees.md). Only what reaches the fund counts:
 * the integrator leg (0.25 bp of notional on each side that names an integrator) is taken out, and
 * the rest goes through the SDK's own feeBreakdown, which applies the skim.
 */
import { EBP_SCALE, previews, ZERO_ADDRESS } from "@liberta-labs/bazaar-sdk";
import type { Address } from "viem";

export const RETURN_WINDOW_SECONDS = 30 * 86_400;
/** The shortest window a yield is annualized over: a market listed an hour ago doesn't multiply an hour's fees by 8,760. */
export const MIN_RETURN_WINDOW_SECONDS = 86_400;
const YEAR_SECONDS = 365 * 86_400;

/**
 * The window a fund's yield is measured over: the trailing 30 days, or the fund's whole life when it is
 * younger (from its first insurance event, the deposit made when the market was listed), so a new
 * market's fees aren't spread over days before it existed. At least a day; the full 30 days when the
 * fund's start isn't known.
 */
export function returnWindowSeconds(now: number, fundStartedAt: number | null, window: number = RETURN_WINDOW_SECONDS): number {
  if (fundStartedAt === null) return window;
  return Math.min(window, Math.max(MIN_RETURN_WINDOW_SECONDS, now - fundStartedAt));
}

/** Whose fees a yield was worked from, for its tooltip: "30 days' fees", or "the 4 days' fees since listing". */
export function windowText(seconds: number): string {
  const days = Math.max(1, Math.round(seconds / 86_400));
  if (seconds >= RETURN_WINDOW_SECONDS) return `${days} days' fees`;
  return days === 1 ? "the day's fees since listing" : `the ${days} days' fees since listing`;
}

/** The parts of a subgraph Trade the estimate reads. */
export interface FeeTrade {
  readonly notional: bigint;
  readonly makerFee: bigint;
  readonly takerFee: bigint;
  readonly makerIntegrator: Address;
  readonly takerIntegrator: Address;
  /** When it filled (unix seconds): what puts it in the last day. */
  readonly timestamp?: number;
}

/**
 * The recent window: the market's last 24 hours of trading, which shows a busier market or a fund below
 * target within hours. Trading time, not the clock's: a stock's figure over a weekend or a night is its
 * last day of trading, not zero.
 */
export const RECENT_OPEN_MINUTES = 24 * 60;

/** Where the recent window starts (unix seconds), the trading time in it, and the trading time in a year. */
export interface RecentWindow {
  readonly from: number;
  readonly openSeconds: number;
  readonly yearOpenSeconds: number;
}

/**
 * How many times the base rate a taker adding risk pays now: above 1 while the fund is below its
 * target, up to the 50 bp cap, which is when insuring the market pays most. 1 at or above target.
 */
export function feeMultiplier(coverageRatioBp: bigint, targetRatioBp: bigint): number {
  const r = previews.takerInsuranceFeeRates(coverageRatioBp, targetRatioBp);
  return r.closingEbp > 0n ? Number((r.takerEbp * 1000n) / r.closingEbp) / 1000 : 1;
}

const hasIntegrator = (a: Address) => a.toLowerCase() !== ZERO_ADDRESS.toLowerCase();

/** One side's fee split into its legs, the integrator leg at its flat 0.25 bp rate. */
function sideFee(fee: bigint, notional: bigint, integrator: Address, ebp: bigint): previews.FillFee {
  const integratorLeg = hasIntegrator(integrator) ? (notional * ebp) / EBP_SCALE : 0n;
  const leg = integratorLeg > fee ? fee : integratorLeg;
  return { insurance: fee - leg, integrator: leg, total: fee };
}

/** What one fill credited to the insurance fund: both sides' insurance legs, less the 1% skim. */
export function insuranceFeeOf(t: FeeTrade): bigint {
  const maker = sideFee(t.makerFee, t.notional, t.makerIntegrator, previews.MAKER_INTEGRATOR_FEE_EBP);
  const taker = sideFee(t.takerFee, t.notional, t.takerIntegrator, previews.TAKER_INTEGRATOR_FEE_EBP);
  return previews.feeBreakdown(maker).toInsuranceFund + previews.feeBreakdown(taker).toInsuranceFund;
}

export interface ReturnEstimate {
  /** What the last 24 hours' fills credited to the fund, 18 decimals. */
  readonly recentFees: bigint;
  /** The last 24 hours' fee yield on the fund's value, times 365; null when the fund is empty. */
  readonly recentApr: number | null;
  /** False when not every fill of the last 24 hours could be read: the yield is then a lower bound. */
  readonly recentComplete: boolean;
  /** What the window's fills credited to the fund, 18 decimals. */
  readonly insuranceFees: bigint;
  /** Annualized fee yield on the fund's value (0.12 = 12% a year); null when the fund is empty. */
  readonly feeApr: number | null;
  /** The share price's change since `sharePriceSince` (0.01 = +1%); null without both prices. */
  readonly sharePriceChange: number | null;
  /** When the share price was measured from (unix seconds); null without a price then. */
  readonly sharePriceSince: number | null;
  /**
   * The share price's change annualized over the time it covers: the net return, fees less whatever the
   * fund paid out (liquidation shortfalls, ADL) and levies. Null without a share price then.
   */
  readonly netApr: number | null;
  /** The window actually covered, in seconds. */
  readonly windowSeconds: number;
  /** False when not every fill in the window could be read: the yield is then a lower bound. */
  readonly complete: boolean;
}

/** A ratio of two 18-decimal amounts as a number, without going through floats for the amounts. */
function ratio(num: bigint, den: bigint): number {
  if (den === 0n) return 0;
  return Number((num * 10n ** 12n) / den) / 1e12;
}

export function estimateInsuranceReturn(args: {
  readonly trades: readonly FeeTrade[];
  /** The fund's value now (its free capital), 18 decimals. */
  readonly fundValue: bigint;
  readonly windowSeconds?: number;
  readonly sharePriceNow?: bigint | null;
  readonly sharePriceThen?: bigint | null;
  /** When sharePriceThen was the price (unix seconds). */
  readonly sharePriceSince?: number | null;
  readonly complete?: boolean;
  /** The recent window (the last 24 hours of trading); without it, the clock's last 24 hours. */
  readonly recent?: RecentWindow;
  /** Whether every fill in the recent window was read. */
  readonly recentComplete?: boolean;
  /** Unix seconds; now unless given. */
  readonly now?: number;
}): ReturnEstimate {
  const windowSeconds = args.windowSeconds ?? RETURN_WINDOW_SECONDS;
  const at = args.now ?? Date.now() / 1000;
  const insuranceFees = args.trades.reduce((s, t) => s + insuranceFeeOf(t), 0n);
  const feeApr = args.fundValue > 0n && windowSeconds > 0 ? ratio(insuranceFees, args.fundValue) * (YEAR_SECONDS / windowSeconds) : null;
  // The last day of trading's fees, scaled by how much trading time a year holds.
  const recent = args.recent ?? { from: at - RECENT_OPEN_MINUTES * 60, openSeconds: RECENT_OPEN_MINUTES * 60, yearOpenSeconds: YEAR_SECONDS };
  const recentFees = args.trades.reduce((s, t) => (t.timestamp !== undefined && t.timestamp >= recent.from ? s + insuranceFeeOf(t) : s), 0n);
  const recentApr = args.fundValue > 0n && recent.openSeconds > 0 ? ratio(recentFees, args.fundValue) * (recent.yearOpenSeconds / recent.openSeconds) : null;
  const now = args.sharePriceNow ?? null;
  const then = args.sharePriceThen ?? null;
  const sharePriceChange = now !== null && then !== null && then > 0n ? ratio(now - then, then) : null;
  const sharePriceSince = sharePriceChange === null ? null : (args.sharePriceSince ?? null);
  // Over the time the change covers, at least a day, as the fee yield.
  const covered = sharePriceSince === null ? null : Math.max(MIN_RETURN_WINDOW_SECONDS, at - sharePriceSince);
  const netApr = sharePriceChange === null || covered === null ? null : sharePriceChange * (YEAR_SECONDS / covered);
  return {
    recentFees,
    recentApr,
    recentComplete: args.recentComplete ?? args.complete ?? true,
    insuranceFees,
    feeApr,
    sharePriceChange,
    sharePriceSince,
    netApr,
    windowSeconds,
    complete: args.complete ?? true,
  };
}

/** The share price an insurance event implies: USD moved per share. Null for events that move no USD. */
export function sharePriceOfEvent(e: { readonly amount: bigint; readonly shares: bigint; readonly kind: string }): bigint | null {
  if ((e.kind !== "Deposit" && e.kind !== "WithdrawalExecuted") || e.shares <= 0n || e.amount <= 0n) return null;
  return (e.amount * 10n ** 18n) / e.shares;
}
