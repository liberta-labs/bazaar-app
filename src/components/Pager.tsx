/**
 * Pages for a table: Previous and Next under it, with where the page sits ("21–40 of 47 · page 2 of 3",
 * "21–40 · page 2" while the list's length isn't known yet, or "Page 2").
 */
import { type ReactNode, useState } from "react";

/** `busy` holds both buttons while the next page is read. */
export function Pager({ page, hasNext, onPage, summary, busy = false }: { page: number; hasNext: boolean; onPage: (page: number) => void; summary: ReactNode; busy?: boolean }) {
  if (page === 0 && !hasNext) return null;
  return (
    <div className="pager">
      <button className="small" onClick={() => onPage(page - 1)} disabled={busy || page === 0} aria-label="Previous page">
        ‹ Previous
      </button>
      <span className="small muted">{summary}</span>
      <button className="small" onClick={() => onPage(page + 1)} disabled={busy || !hasNext} aria-label="Next page">
        Next ›
      </button>
    </div>
  );
}

/** Rows a page of the account's tables shows: balances, positions, open orders and the histories. */
export const ACCOUNT_PAGE = 20;

/**
 * Where page `at` (from 0) sits, holding `count` rows of `size` a page: "21–40 of 47 · page 2 of 3", or
 * "21–40 · page 2" when the list's `total` isn't known.
 */
export function pageSummary(at: number, size: number, count: number, total: number | null): string {
  const from = at * size;
  const range = `${(from + 1).toLocaleString()}–${(from + count).toLocaleString()}`;
  if (total === null) return `${range} · page ${at + 1}`;
  return `${range} of ${total.toLocaleString()} · page ${at + 1} of ${Math.max(1, Math.ceil(total / size))}`;
}

/**
 * A list already in hand, `size` rows a page: the page's rows and its pager. `setPage(0)` starts again from
 * the top, as does a change of `start` (a new sort or filter, say); a list that shrinks keeps to a page
 * that exists.
 */
export function usePaged<T>(rows: readonly T[], size: number, start?: string): { shown: readonly T[]; pager: ReactNode; setPage: (page: number) => void } {
  const [page, setPage] = useState(0);
  const [startedAt, setStartedAt] = useState(start);
  if (startedAt !== start) {
    setStartedAt(start);
    setPage(0);
  }
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(page, pages - 1);
  const shown = rows.slice(at * size, (at + 1) * size);
  const summary = pageSummary(at, size, shown.length, rows.length);
  return { shown, pager: <Pager page={at} hasNext={at < pages - 1} onPage={setPage} summary={summary} />, setPage };
}
