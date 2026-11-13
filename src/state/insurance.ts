/**
 * The account's insurance stakes: the subgraph's providers (one query) valued on chain. The Portfolio's
 * summary and its Balances tab both show them, so they share one read, kept for a minute.
 */
import type { Bazaar } from "@liberta-labs/bazaar-sdk";
import type { Address } from "viem";
import { useAsync } from "../components/ui";
import { useRead } from "./connection";

export interface Stake {
  readonly pair: Address;
  readonly shares: bigint;
  /** Shares in a withdrawal under way. */
  readonly requestedShares: bigint;
  readonly deposited: bigint;
  readonly withdrawn: bigint;
  /** What the shares are worth now, 18 decimals. */
  readonly value: bigint;
}

const KEEP_MS = 60_000;
const cache = new Map<string, { at: number; read: Promise<Stake[]> }>();

function readStakes(bz: Bazaar, user: Address): Promise<Stake[]> {
  const k = user.toLowerCase();
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.read;
  const read = (async () => {
    const providers = (await bz.history.insuranceProviders({ account: user, first: 100 })).items.filter((p) => p.shares > 0n || p.requestedShares > 0n);
    return Promise.all(
      providers.map(async (p) => ({
        pair: p.pair,
        shares: p.shares,
        requestedShares: p.requestedShares,
        deposited: p.deposited,
        withdrawn: p.withdrawn,
        value: await bz.insurance.getInsuranceDepositValue(p.pair, user).catch(() => 0n),
      })),
    );
  })();
  read.catch(() => cache.delete(k));
  cache.set(k, { at: Date.now(), read });
  return read;
}

export function useInsuranceStakes(user: Address | null | undefined) {
  const { readBz } = useRead();
  return useAsync(async () => (readBz && user ? readStakes(readBz, user) : []), [readBz, user]);
}
