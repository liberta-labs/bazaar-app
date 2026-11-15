/**
 * Pages for a table: Previous and Next under it, with where the page sits ("21–40 of 47 · page 2 of 3",
 * or "Page 2" for a list read a page at a time, whose length isn't known).
 */
import { type ReactNode, useState } from "react";

export function Pager({ page, hasNext, onPage, summary }: { page: number; hasNext: boolean; onPage: (page: number) => void; summary: ReactNode }) {
  if (page === 0 && !hasNext) return null;
  return (
    <div className="pager">
      <button className="small" onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page">
        ‹ Previous
      </button>
      <span className="small muted">{summary}</span>
      <button className="small" onClick={() => onPage(page + 1)} disabled={!hasNext} aria-label="Next page">
        Next ›
      </button>
    </div>
  );
}

/**
 * A list already in hand, `size` rows a page: the page's rows and its pager. `setPage(0)` starts again from
 * the top (after a new sort, say); a list that shrinks keeps to a page that exists.
 */
export function usePaged<T>(rows: readonly T[], size: number): { shown: readonly T[]; pager: ReactNode; setPage: (page: number) => void } {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(page, pages - 1);
  const shown = rows.slice(at * size, (at + 1) * size);
  const summary = `${(at * size + 1).toLocaleString()}–${(at * size + shown.length).toLocaleString()} of ${rows.length.toLocaleString()} · page ${at + 1} of ${pages}`;
  return { shown, pager: <Pager page={at} hasNext={at < pages - 1} onPage={setPage} summary={summary} />, setPage };
}
