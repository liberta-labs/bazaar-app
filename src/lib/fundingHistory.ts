/**
 * Funding payments, worked out from an account's position snapshots. The chain records no payment as
 * such: funding settles into collateral only when shares close (MatchingEngineLib). A reduce settles the
 * closed shares' slice of the position's funding, a close or a flip all of it, and an add only blends
 * the entry funding index. So each snapshot that closes shares carries one payment: the funding the
 * position held before had accrued by that event's funding index (the SDK's bucketState formula), times
 * the share closed.
 *
 * Two closes are not payments of the usual kind: a liquidation, whose estate takes its funding with it
 * (skipped), and an ADL close, which withholds what the fund can't pay from the winner's funding income
 * (AdlFill.withheldFunding, taken off).
 */
import { bucketState, type history } from "@liberta-labs/bazaar-sdk";
import type { Address, Hex } from "viem";

export interface FundingPayment {
  readonly key: string;
  readonly pair: Address;
  readonly timestamp: number;
  readonly transactionHash: Hex;
  /** The position before the close. */
  readonly isLong: boolean;
  readonly sizeBefore: bigint;
  /** The size closed, whose funding settled. */
  readonly closed: bigint;
  /** Received (positive) or paid (negative), 18 decimals. */
  readonly amount: bigint;
  readonly via: "trade" | "adl" | "settlement";
}

type Snapshot = Pick<history.PositionSnapshot, "id" | "pair" | "isLong" | "size" | "entryFundingIndex" | "globalFundingIndex" | "imrBp" | "timestamp" | "transactionHash" | "logIndex">;

/** "<tx>-<pair>", lower case: how an event is matched to the snapshot its transaction wrote. */
export const txPairKey = (tx: string, pair: string) => `${tx.toLowerCase()}-${pair.toLowerCase()}`;

/**
 * Every funding payment in `snapshots` (any order), newest first. `liquidations` holds the txPairKeys of
 * the account's liquidations; `adlWithheld` the funding each ADL close withheld, by txPairKey.
 */
export function fundingPayments(
  snapshots: readonly Snapshot[],
  liquidations: ReadonlySet<string> = new Set(),
  adlWithheld: ReadonlyMap<string, bigint> = new Map(),
): FundingPayment[] {
  const byPair = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    const k = s.pair.toLowerCase();
    byPair.set(k, [...(byPair.get(k) ?? []), s]);
  }
  const out: FundingPayment[] = [];
  for (const list of byPair.values()) {
    list.sort((a, b) => a.timestamp - b.timestamp || a.logIndex - b.logIndex);
    let prev: Snapshot | null = null;
    for (const s of list) {
      if (prev && prev.size > 0n) {
        const flipped = s.size > 0n && s.isLong !== prev.isLong;
        const closed = s.size === 0n || flipped ? prev.size : s.size < prev.size ? prev.size - s.size : 0n;
        const key = txPairKey(s.transactionHash, s.pair);
        if (closed > 0n && !liquidations.has(key)) {
          const funding = bucketState(prev.isLong, prev.size, 0n, 0n, prev.entryFundingIndex, 0n, s.globalFundingIndex, 0n).fundingPnl;
          const withheld = adlWithheld.get(key);
          const amount = (funding * closed) / prev.size - (withheld ?? 0n);
          if (amount !== 0n) {
            out.push({
              key: s.id,
              pair: s.pair,
              timestamp: s.timestamp,
              transactionHash: s.transactionHash,
              isLong: prev.isLong,
              sizeBefore: prev.size,
              closed,
              amount,
              via: withheld !== undefined ? "adl" : s.imrBp === 0n ? "settlement" : "trade",
            });
          }
        }
      }
      prev = s;
    }
  }
  return out.sort((a, b) => b.timestamp - a.timestamp);
}
