/**
 * Shared reads: market snapshots, the account followed live, and helpers that value it at the
 * board's price on every tick. Every read passes the board as `prices`, so snapshots value
 * positions at the live price and judge closed venues without a Pyth key.
 */
import { account, type markets } from "@liberta-labs/bazaar-sdk";
import { type ReactNode, createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { reloadIn, settleMs } from "../lib/historySync";
import { useBoard, useRead, useWallet } from "./connection";
import { useActivity, usePageActive } from "./activity";
import { usePoll } from "./poll";

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

/** Every market's snapshot, read in one batch and refreshed every 15 seconds while the page is in use. */
export function useMarketSnapshots(): { snaps: ReadonlyMap<Address, markets.MarketSnapshot>; loading: boolean; error: string | null } {
  const { readBz, markets: list } = useRead();
  const prices = useStablePrices();
  const [snaps, setSnaps] = useState<ReadonlyMap<Address, markets.MarketSnapshot>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  usePoll(
    async (isDead) => {
      if (!readBz) return;
      try {
        const s = await readBz.markets.marketSnapshots(list, { prices, fetchPrices: false });
        if (!isDead()) {
          setSnaps(s);
          setError(null);
        }
      } catch (e) {
        console.error("snapshots", e);
        if (!isDead()) setError("Market data is unavailable right now.");
      } finally {
        if (!isDead()) setLoading(false);
      }
    },
    15_000,
    [readBz, list, prices],
    Boolean(readBz) && list.length > 0,
  );
  return { snaps, loading, error };
}

export interface LiveAccount {
  /** Snapshot per market, for every market (used or not), once loaded. */
  readonly snaps: ReadonlyMap<Address, account.AccountSnapshot>;
  readonly loaded: boolean;
  /** Read every market again now (after the user's own transaction lands). */
  readonly refresh: () => void;
  /**
   * Goes up once the subgraph should have caught up with the account's latest change on chain (a
   * fill, an order, a deposit), and when updates resume after a pause. A history table that reloads
   * when it changes shows what just happened without a Refresh.
   */
  readonly historyVersion: number;
}

/** Whether a live event names `owner` among its arguments: a trade, order, deposit or the like of theirs. */
function namesAccount(args: object, owner: string): boolean {
  const me = owner.toLowerCase();
  return Object.values(args).some((v) => typeof v === "string" && v.toLowerCase() === me);
}

/**
 * Counts up when the subgraph should hold what `changes` counted: the board's measure of the
 * subgraph's trail after the last change (lib/historySync.ts). A resume after a pause counts as a
 * change, since the watch saw nothing meanwhile.
 */
function useHistoryVersion(changes: number): number {
  const { prices } = useBoard();
  const { resumes } = useActivity();
  const lag = useRef<number | null>(null);
  lag.current = prices?.subgraph()?.secondsBehind ?? null;
  const since = useRef<number | null>(null);
  const [version, setVersion] = useState(0);
  const pending = changes + resumes;
  useEffect(() => {
    if (pending === 0) return;
    const now = performance.now();
    since.current ??= now;
    const t = setTimeout(
      () => {
        since.current = null;
        setVersion((v) => v + 1);
      },
      reloadIn(now, since.current, settleMs(lag.current)),
    );
    return () => clearTimeout(t);
  }, [pending]);
  return version;
}

/** True when the account has anything on the market. */
export const usesMarket = (s: account.AccountSnapshot) =>
  s.hasPosition || s.position.collateral > 0n || s.orders.length > 0 || s.claimableFees > 0n || (s.terminal?.payout ?? 0n) > 0n;

/**
 * The connected account on every market, followed live with watchAccount: a fresh snapshot for each
 * market an event touches, and all of them every 15 seconds. One watch for the whole app, shared
 * through LiveAccountProvider. The watch is stopped while nobody is using the page, keeping what it
 * showed, and started again (reading every market at once) when they are back.
 */
function useAccountWatch(): LiveAccount {
  const { readBz, markets: list } = useRead();
  const { address } = useWallet();
  const prices = useStablePrices();
  const [snaps, setSnaps] = useState<ReadonlyMap<Address, account.AccountSnapshot>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const [changes, setChanges] = useState(0);
  const historyVersion = useHistoryVersion(changes);
  const handle = useRef<{ refresh(): void; stop(): void } | null>(null);
  const inUse = usePageActive();

  // Another account, chain connection or market list: what was shown is no longer this account's.
  useEffect(() => {
    setSnaps(new Map());
    setLoaded(false);
  }, [readBz, address, list]);

  useEffect(() => {
    if (!readBz || !address || !list.length || !inUse) return;
    const h = readBz.live.watchAccount(
      address,
      list,
      (u) => {
        // The account's own events, not the market-wide ones the watch also passes on.
        if (u.type === "event" && namesAccount(u.event.args, address)) setChanges((c) => c + 1);
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
  }, [readBz, address, list, prices, inUse]);

  return useMemo(() => ({ snaps, loaded, refresh: () => handle.current?.refresh(), historyVersion }), [snaps, loaded, historyVersion]);
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
  /**
   * The day's first hourly trade candle's open: the 24-hour change's reference only for a market the
   * price board has no price 24 hours ago for (lib/board.ts `dayChange`). Null when the day comes from
   * the board, which gives the volume alone.
   */
  readonly open: bigint | null;
  readonly volume: bigint;
}

/**
 * How often the page reads the day's stats itself, when the board does not publish them. Hourly candles
 * move slowly, and every read is a query per market.
 */
const DAY_STATS_EVERY_MS = 5 * 60_000;

interface DayStatsHub {
  readonly stats: ReadonlyMap<Address, DayStats>;
  /** Registers a component that shows the stats; returns its release. */
  readonly want: () => () => void;
}

/**
 * Each market's last 24 hours. From the price board when the service reads the chain's history: it
 * publishes every listing's volume, so the page asks the subgraph for nothing. Otherwise (an older
 * service, one without a subgraph, or no board at all) from 24 hourly candles per market, read once for
 * the whole app and only while a component on screen needs them and the tab is visible; what was read
 * stays shown in between.
 */
function useDayStatsWatch(): DayStatsHub {
  const { readBz, markets: list } = useRead();
  const { prices, error: boardError } = useBoard();
  // null until the first board arrives: the page waits for it before asking the subgraph itself.
  const fromBoard = prices === null ? (boardError === null ? null : false) : prices.subgraph() !== null;
  const [read, setStats] = useState<ReadonlyMap<Address, DayStats>>(new Map());
  const [wanted, setWanted] = useState(0);
  const want = useCallback(() => {
    setWanted((n) => n + 1);
    return () => setWanted((n) => n - 1);
  }, []);
  usePoll(
    async (isDead) => {
      if (!readBz) return;
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
      if (!isDead()) setStats(out);
    },
    DAY_STATS_EVERY_MS,
    [readBz, list],
    Boolean(readBz) && list.length > 0 && wanted > 0 && fromBoard === false,
  );
  const stats = useMemo(() => {
    if (!fromBoard || prices === null) return read;
    const out = new Map<Address, DayStats>();
    for (const m of list) {
      const day = prices.day(m.address);
      if (day) out.set(m.address, { open: null, volume: day.volume });
    }
    return out;
  }, [fromBoard, prices, list, read]);
  return useMemo(() => ({ stats, want }), [stats, want]);
}

const DayStatsCtx = createContext<DayStatsHub | null>(null);

export function DayStatsProvider({ children }: { children: ReactNode }) {
  return createElement(DayStatsCtx.Provider, { value: useDayStatsWatch() }, children);
}

/**
 * Every market's day stats (empty until read, or while their source is unreachable). `need` false shows
 * what is already known without asking the subgraph for more: the header's ticker, once the price board
 * gives every market its price 24 hours ago, needs nothing else.
 */
export function useDayStats(need = true): ReadonlyMap<Address, DayStats> {
  const hub = useContext(DayStatsCtx);
  if (!hub) throw new Error("useDayStats outside DayStatsProvider");
  const { want } = hub;
  useEffect(() => (need ? want() : undefined), [want, need]);
  return hub.stats;
}

