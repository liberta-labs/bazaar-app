/**
 * Your watchlist: the markets you starred, kept in this browser (localStorage) and shared by every
 * component and every open tab. Market addresses, in lower case.
 */
import { useCallback, useSyncExternalStore } from "react";

const KEY = "bazaar.watchlist";
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

function load(): ReadonlySet<string> {
  try {
    return parseWatchlist(localStorage.getItem(KEY));
  } catch {
    return new Set();
  }
}

let current = load();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

// A star set in another tab shows here too.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY && e.key !== null) return;
    current = load();
    emit();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWatchlist() {
  const starred = useSyncExternalStore(subscribe, () => current, () => current);
  const toggle = useCallback((address: string) => {
    const a = address.toLowerCase();
    const next = new Set(current);
    if (next.has(a)) next.delete(a);
    else next.add(a);
    current = next;
    try {
      localStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {
      /* storage blocked: the star lasts until the page reloads */
    }
    emit();
  }, []);
  const has = useCallback((address: string) => starred.has(address.toLowerCase()), [starred]);
  return { starred, has, toggle };
}
