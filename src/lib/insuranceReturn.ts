/**
 * An estimated return for insuring a market: the insurance fund's share of the trailing window's
 * trading fees over the fund's value, annualized. Past performance only: liquidation losses beyond
 * maintenance margin come out of the same fund and can lower the share price.
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
  /** What the window's fills credited to the fund, 18 decimals. */
  readonly insuranceFees: bigint;
  /** Annualized fee yield on the fund's value (0.12 = 12% a year); null when the fund is empty. */
  readonly feeApr: number | null;
  /** The share price's change over the window (0.01 = +1%); null without both prices. */
  readonly sharePriceChange: number | null;
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
  readonly complete?: boolean;
}): ReturnEstimate {
  const windowSeconds = args.windowSeconds ?? RETURN_WINDOW_SECONDS;
  const insuranceFees = args.trades.reduce((s, t) => s + insuranceFeeOf(t), 0n);
  const feeApr = args.fundValue > 0n && windowSeconds > 0 ? ratio(insuranceFees, args.fundValue) * (YEAR_SECONDS / windowSeconds) : null;
  const now = args.sharePriceNow ?? null;
  const then = args.sharePriceThen ?? null;
  const sharePriceChange = now !== null && then !== null && then > 0n ? ratio(now - then, then) : null;
  return { insuranceFees, feeApr, sharePriceChange, windowSeconds, complete: args.complete ?? true };
}

/** The share price an insurance event implies: USD moved per share. Null for events that move no USD. */
export function sharePriceOfEvent(e: { readonly amount: bigint; readonly shares: bigint; readonly kind: string }): bigint | null {
  if ((e.kind !== "Deposit" && e.kind !== "WithdrawalExecuted") || e.shares <= 0n || e.amount <= 0n) return null;
  return (e.amount * 10n ** 18n) / e.shares;
}
