/**
 * Shared reads: market snapshots, the account followed live, and helpers that value it at the
 * board's price on every tick. Every read passes the board as `prices`, so snapshots value
 * positions at the live price and judge closed venues without a Pyth key.
 */
import { account, type markets } from "@liberta-labs/bazaar-sdk";
import { type ReactNode, createContext, createElement, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { useBoard, useRead, useWallet } from "./connection";

/** A LivePriceView that always reads the latest board, for watchers started once. */
export function useStablePrices(): markets.LivePriceView {
  const { prices } = useBoard();
  const ref = useRef(prices);
  ref.current = prices;
  return useMemo<markets.LivePriceView>(
    () => ({
      price: (pair) => ref.current?.price(pair) ?? null,
      venueClosed: (pair) => ref.current?.venueClosed(pair) ?? false,
    }),
    [],
  );
}

/** Every market's snapshot, read in one batch and refreshed every 15 seconds. */
export function useMarketSnapshots(): { snaps: ReadonlyMap<Address, markets.MarketSnapshot>; loading: boolean; error: string | null } {
  const { readBz, markets: list } = useRead();
  const prices = useStablePrices();
  const [snaps, setSnaps] = useState<ReadonlyMap<Address, markets.MarketSnapshot>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!readBz || !list.length) return;
    let dead = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await readBz.markets.marketSnapshots(list, { prices, fetchPrices: false });
        if (!dead) {
          setSnaps(s);
          setError(null);
        }
      } catch (e) {
        console.error("snapshots", e);
        if (!dead) setError("Market data is unavailable right now.");
      } finally {
        if (!dead) {
          setLoading(false);
          timer = setTimeout(tick, 15_000);
        }
      }
    };
    void tick();
    return () => {
      dead = true;
      clearTimeout(timer);
    };
  }, [readBz, list, prices]);
  return { snaps, loading, error };
}

export interface LiveAccount {
  /** Snapshot per market, for every market (used or not), once loaded. */
  readonly snaps: ReadonlyMap<Address, account.AccountSnapshot>;
  readonly loaded: boolean;
  /** Read every market again now (after the user's own transaction lands). */
  readonly refresh: () => void;
}

/** True when the account has anything on the market. */
export const usesMarket = (s: account.AccountSnapshot) =>
  s.hasPosition || s.position.collateral > 0n || s.orders.length > 0 || s.claimableFees > 0n || (s.terminal?.payout ?? 0n) > 0n;

/**
 * The connected account on every market, followed live with watchAccount: a fresh snapshot for each
 * market an event touches, and all of them every 15 seconds. One watch for the whole app, shared
 * through LiveAccountProvider.
 */
function useAccountWatch(): LiveAccount {
  const { readBz, markets: list } = useRead();
  const { address } = useWallet();
  const prices = useStablePrices();
  const [snaps, setSnaps] = useState<ReadonlyMap<Address, account.AccountSnapshot>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const handle = useRef<{ refresh(): void; stop(): void } | null>(null);

  useEffect(() => {
    setSnaps(new Map());
    setLoaded(false);
    if (!readBz || !address || !list.length) return;
    const h = readBz.live.watchAccount(
      address,
      list,
      (u) => {
        if (u.type === "account") {
          setSnaps((m) => new Map(m).set(u.snapshot.market.address, u.snapshot));
          if (u.cause === "initial" || u.cause === "manual") setLoaded(true);
        }
        if (u.type === "error") console.warn("account watch", u.error);
      },
      { prices, fetchPrices: false },
    );
    handle.current = h;
    void h.ready.then(() => setLoaded(true));
    return () => {
      h.stop();
      handle.current = null;
    };
  }, [readBz, address, list, prices]);

  return useMemo(() => ({ snaps, loaded, refresh: () => handle.current?.refresh() }), [snaps, loaded]);
}

/** A snapshot's health at the board's current price (recomputed on every board tick). */
export function useLiveHealth(s: account.AccountSnapshot | undefined): account.PositionHealth | null {
  const { prices } = useBoard();
  return useMemo(() => {
    if (!s || !s.hasPosition) return null;
    const p = prices?.price(s.market.address);
    return p ? account.accountHealth(s, p) : s.health;
  }, [s, prices]);
}

const LiveAccountCtx = createContext<LiveAccount | null>(null);

export function LiveAccountProvider({ children }: { children: ReactNode }) {
  return createElement(LiveAccountCtx.Provider, { value: useAccountWatch() }, children);
}

export function useLiveAccount(): LiveAccount {
  const v = useContext(LiveAccountCtx);
  if (!v) throw new Error("useLiveAccount outside LiveAccountProvider");
  return v;
}

export interface DayStats {
  readonly open: bigint | null;
  readonly volume: bigint;
}

/** 24 hours of hourly candles per market: the price 24 h ago and the day's volume. */
export function useDayStats(list: readonly markets.MarketInfo[]): ReadonlyMap<Address, DayStats> {
  const { readBz } = useRead();
  const [stats, setStats] = useState<ReadonlyMap<Address, DayStats>>(new Map());
  useEffect(() => {
    if (!readBz || !list.length) return;
    let dead = false;
    const load = async () => {
      const now = Math.floor(Date.now() / 1000);
      const from = now - (now % 3600) - 23 * 3600;
      const out = new Map<Address, DayStats>();
      await Promise.all(
        list.map(async (m) => {
          try {
            const page = await readBz.history.candles(m.address, 3600, { from, first: 30 });
            const rows = page.items;
            out.set(m.address, { open: rows[0]?.open ?? null, volume: rows.reduce((s, c) => s + c.volumeNotional, 0n) });
          } catch {
            /* history unavailable for this market: leave it blank */
          }
        }),
      );
      if (!dead) setStats(out);
    };
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [readBz, list]);
  return stats;
}

