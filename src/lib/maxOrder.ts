/**
 * The largest order the collateral on a market allows: what that collateral backs at the chosen
 * leverage once the taker fee is paid. It follows the ticket's own rule, which asks the whole order's
 * notional over the leverage in margin (a part that closes an opposite position included), so an amount
 * from Max never calls for a deposit. Room is held back for the price moving between the click and the
 * fill: the order's slippage limit for a market order, and a little more.
 */
import { BAZAAR_SCALE, type BucketState, EBP_SCALE, previews } from "@liberta-labs/bazaar-sdk";

const MAX_UINT = 2n ** 256n - 1n;
/** Room on top of the order's own slippage limit: 0.25%. */
export const MAX_ROOM_BP = 25n;
/** Room in the pair's creation check for the mark moving before the order lands: 0.5%. */
export const GATE_ROOM_BP = 50n;

/** The taker insurance fee a new position pays now (EBP), from the fund's coverage and target, as the pair works it out. */
export function takerFeeEbp(fund: { readonly freeCapital: bigint; readonly targetRatioBp: bigint }, openInterestNotional: bigint): bigint {
  const coverageBp = openInterestNotional > 0n ? (fund.freeCapital * 10_000n) / openInterestNotional : MAX_UINT;
  return previews.takerInsuranceFeeRates(coverageBp, fund.targetRatioBp).takerEbp;
}

/**
 * The size (base asset, 18 decimals) of the largest order: `free` collateral (18 decimals) at leverage
 * `lev10` / 10 backs N of notional where N / leverage + N × fee = free, sized at `price` raised by
 * `roomBp` so a worse fill still fits. Null when that comes to nothing.
 */
export function maxOrderSize(p: { readonly free: bigint; readonly lev10: number; readonly price: bigint; readonly takerEbp: bigint; readonly roomBp: bigint }): bigint | null {
  if (p.price <= 0n || p.lev10 <= 0 || p.free <= 0n) return null;
  const lev10 = BigInt(p.lev10);
  const notional = (p.free * lev10 * EBP_SCALE) / (10n * EBP_SCALE + lev10 * p.takerEbp);
  const worstPrice = (p.price * (10_000n + p.roomBp)) / 10_000n;
  const size = (notional * BAZAAR_SCALE) / worstPrice;
  return size > 0n ? size : null;
}

/**
 * The leverage an order uses, in tenths (20 is 2.0×), by the same rule as `maxOrderSize`: its notional
 * over the collateral that backs it once the taker fee is paid. So Max at this leverage gives back about
 * the same order, and the ticket asks no deposit for it. Rounded to the nearest tenth. Null when the
 * collateral doesn't cover the order's fee, where only a deposit can back it.
 */
export function orderLev10(p: { readonly notional: bigint; readonly backing: bigint; readonly takerEbp: bigint }): number | null {
  if (p.notional <= 0n) return 0;
  const left = p.backing * EBP_SCALE - p.notional * p.takerEbp;
  if (left <= 0n) return null;
  return Number((p.notional * 20n * EBP_SCALE + left) / (2n * left));
}

/**
 * The largest size, up to `upTo`, that the pair's creation check accepts (previews.creationGate, the
 * SDK's copy of OrderManagementLib._creationShortfall): initial margin on the position the order leaves,
 * the order valued at the mark or worse (a market order at its far slippage bound), with resting orders,
 * fill debits and any unrealized loss counted against the collateral. The check grows with size, so a
 * binary search finds the edge. The mark is judged `roomBp` higher, since it will have moved by the
 * time the order lands. 0 when even the smallest size fails.
 */
export function maxGateSize(p: {
  readonly order: { readonly orderType: number; readonly isLong: boolean; readonly limitPrice: bigint; readonly triggerPrice: bigint; readonly maxSlippageBp: bigint };
  readonly position: previews.Bucket;
  readonly state: BucketState;
  readonly mark: bigint;
  readonly imrBp: bigint;
  readonly resting: previews.RestingReserve;
  readonly upTo: bigint;
  readonly roomBp?: bigint;
}): bigint {
  const mark = (p.mark * (10_000n + (p.roomBp ?? 0n))) / 10_000n;
  const ok = (size: bigint) => previews.creationGate({ ...p.order, size, hasIntegrator: false }, p.position, p.state, mark, p.imrBp, p.resting).ok;
  if (p.upTo <= 0n) return 0n;
  if (ok(p.upTo)) return p.upTo;
  let lo = 0n;
  let hi = p.upTo;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
