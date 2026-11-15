/**
 * Your watchlists: the markets you starred, kept in this browser (localStorage) and shared by every
 * component and every open tab. Market addresses, in lower case.
 *
 * There are two, kept apart: "trade", the markets you follow to trade (the markets page and the trade
 * page's market picker), and "earn", the insurance funds you follow on the Earn page. Starring a market
 * in one leaves the other as it was.
 */
import { useCallback, useSyncExternalStore } from "react";

export type WatchlistName = "trade" | "earn";

/** Where each list is stored. "trade" keeps the key the one shared list had, so stars set before stay. */
export const WATCHLIST_KEYS: Readonly<Record<WatchlistName, string>> = { trade: "bazaar.watchlist", earn: "bazaar.earnWatchlist" };

const ADDRESS = /^0x[0-9a-f]{40}$/;

/** The stored list, read strictly: anything that isn't a market address is dropped. */
export function parseWatchlist(raw: string | null): ReadonlySet<string> {
  if (!raw) return new Set();
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return new Set();
    return new Set(
      v
        .filter((a): a is string => typeof a === "string")
        .map((a) => a.toLowerCase())
        .filter((a) => ADDRESS.test(a)),
    );
  } catch {
    return new Set();
  }
}

function load(name: WatchlistName): ReadonlySet<string> {
  try {
    return parseWatchlist(localStorage.getItem(WATCHLIST_KEYS[name]));
  } catch {
    return new Set();
  }
}

interface Store {
  current: ReadonlySet<string>;
  readonly listeners: Set<() => void>;
  readonly subscribe: (listener: () => void) => () => void;
}

const stores = new Map<WatchlistName, Store>();

function storeOf(name: WatchlistName): Store {
  let s = stores.get(name);
  if (!s) {
    const listeners = new Set<() => void>();
    s = {
      current: load(name),
      listeners,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    stores.set(name, s);
  }
  return s;
}

const emit = (s: Store) => s.listeners.forEach((l) => l());

// A star set in another tab shows here too, in the list it was set in.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    for (const [name, s] of stores) {
      if (e.key !== null && e.key !== WATCHLIST_KEYS[name]) continue;
      s.current = load(name);
      emit(s);
    }
  });
}

/** The markets on a watchlist now. */
export const watched = (name: WatchlistName): ReadonlySet<string> => storeOf(name).current;

/** Stars a market on one watchlist, or takes it off; the other list is untouched. */
export function toggleWatched(name: WatchlistName, address: string): void {
  const s = storeOf(name);
  const a = address.toLowerCase();
  const next = new Set(s.current);
  if (next.has(a)) next.delete(a);
  else next.add(a);
  s.current = next;
  try {
    localStorage.setItem(WATCHLIST_KEYS[name], JSON.stringify([...next]));
  } catch {
    /* storage blocked: the star lasts until the page reloads */
  }
  emit(s);
}

/** One watchlist, kept current: "trade" unless the page says otherwise. */
export function useWatchlist(name: WatchlistName = "trade") {
  const s = storeOf(name);
  const starred = useSyncExternalStore(s.subscribe, () => s.current, () => s.current);
  const toggle = useCallback((address: string) => toggleWatched(name, address), [name]);
  const has = useCallback((address: string) => starred.has(address.toLowerCase()), [starred]);
  return { starred, has, toggle };
}
