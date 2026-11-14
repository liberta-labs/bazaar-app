/**
 * The market filters: All, Watchlist and each kind of asset (lib/marketCategory.ts), as a row of
 * chips, the one picked last kept per browser. The markets page and the trade page's market picker
 * share them, each remembering its own pick.
 */
import type { markets as mk } from "@liberta-labs/bazaar-sdk";
import { useMemo, useState } from "react";
import { CATEGORIES, type MarketCategory, marketCategory } from "../lib/marketCategory";
import { useWatchlist } from "../state/watchlist";
import { StarIcon } from "./StarButton";

/** What a list shows: every market, your starred ones, or one kind of asset. */
export type MarketFilter = "all" | "watchlist" | MarketCategory;

function isFilter(v: string | null): v is MarketFilter {
  return v === "all" || v === "watchlist" || CATEGORIES.some((c) => c.id === v);
}

/** Whether a market's name, description or address holds the search text (trimmed, lower case; empty matches all). */
export function matchesSearch(m: mk.MarketInfo, needle: string): boolean {
  return !needle || m.label.toLowerCase().includes(needle) || m.description.toLowerCase().includes(needle) || m.address.toLowerCase().includes(needle);
}

export interface MarketFilterState {
  /** The chips: All and Watchlist always, a kind of asset only while some market is one, each with its count. */
  readonly filters: readonly { readonly id: MarketFilter; readonly label: string; readonly n: number }[];
  readonly filter: MarketFilter;
  /** The picked chip's label: "Stocks". */
  readonly label: string;
  readonly pick: (f: MarketFilter) => void;
  readonly inFilter: (m: mk.MarketInfo) => boolean;
}

/** The filter state for a list of markets, the pick kept in localStorage under `storageKey`. */
export function useMarketFilter(list: readonly mk.MarketInfo[], storageKey: string): MarketFilterState {
  const { has: starred } = useWatchlist();
  const [picked, setPicked] = useState<MarketFilter>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return isFilter(v) ? v : "all";
    } catch {
      return "all";
    }
  });
  const pick = (f: MarketFilter) => {
    setPicked(f);
    try {
      localStorage.setItem(storageKey, f);
    } catch {
      /* storage blocked: the filter lasts until the page reloads */
    }
  };
  const category = useMemo(() => new Map(list.map((m) => [m.address, marketCategory(m)])), [list]);
  const filters = [
    { id: "all" as MarketFilter, label: "All", n: list.length },
    { id: "watchlist" as MarketFilter, label: "Watchlist", n: list.filter((m) => starred(m.address)).length },
    ...CATEGORIES.map((c) => ({ ...c, n: list.filter((m) => category.get(m.address) === c.id).length })).filter((c) => c.n > 0),
  ];
  // A kind picked on an earlier visit that has no market now shows everything.
  const filter: MarketFilter = list.length && !filters.some((f) => f.id === picked) ? "all" : picked;
  return {
    filters,
    filter,
    label: filters.find((f) => f.id === filter)?.label ?? "",
    pick,
    inFilter: (m) => filter === "all" || (filter === "watchlist" ? starred(m.address) : category.get(m.address) === filter),
  };
}

export function MarketFilterChips({ state }: { state: MarketFilterState }) {
  return (
    <div className="market-filters" role="group" aria-label="Show markets">
      {state.filters.map((f) => (
        <button key={f.id} type="button" className={`chip${f.id === state.filter ? " on" : ""}`} aria-pressed={f.id === state.filter} onClick={() => state.pick(f.id)}>
          {f.id === "watchlist" && <StarIcon filled size={13} />}
          {f.label}
          <span className="count">{f.n}</span>
        </button>
      ))}
    </div>
  );
}
