/**
 * Sortable tables: `useSort(rows, keys)` gives the rows in the order the user picked and, for each
 * column, the header's props. A click (or Enter or Space) on a header sorts by it, again reverses it,
 * and a third time returns the table to its own order.
 */
import { type KeyboardEvent, useState } from "react";
import { type SortState, type SortValue, firstDir, nextSortFrom, sortRows } from "../lib/sort";

export interface SortHeaderProps {
  readonly className: string;
  readonly onClick: () => void;
  readonly onKeyDown: (e: KeyboardEvent) => void;
  readonly tabIndex: number;
  readonly "aria-sort": "ascending" | "descending" | "none";
  readonly "data-sort": "asc" | "desc" | undefined;
  readonly title: string;
}

/**
 * `initial` opens the table sorted by one of its columns (the markets page: 24-hour volume, highest
 * first); a third click on a header then returns to that sort rather than the rows' own order.
 */
export function useSort<T>(rows: readonly T[], keys: Readonly<Record<string, (row: T) => SortValue>>, initial: SortState | null = null) {
  const [state, setState] = useState<SortState | null>(initial);
  const by = state ? keys[state.key] : undefined;
  const sorted: readonly T[] = state && by ? sortRows(rows, by, state.dir) : rows;
  /** Props for the header of column `key`, with any classes of its own. */
  const th = (key: string, className = ""): SortHeaderProps => {
    const dir = state?.key === key ? state.dir : undefined;
    const toggle = () => setState((s) => nextSortFrom(s, key, firstDir(rows, keys[key] ?? (() => null)), initial));
    return {
      className: `sortable ${className}`.trim(),
      onClick: toggle,
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      },
      tabIndex: 0,
      "aria-sort": dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none",
      "data-sort": dir,
      title: dir === undefined ? "Sort by this column" : dir === "asc" ? "Sorted low to high; click to reverse" : "Sorted high to low; click to reverse",
    };
  };
  /** The order shown, as text that changes with it ("" for the rows' own order), for a pager to start again on. */
  const order = state && by ? `${state.key}:${state.dir}` : "";
  return { sorted, th, sorting: state !== null && by !== undefined, order };
}
