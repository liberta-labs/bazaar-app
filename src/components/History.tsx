/**
 * A history list from the subgraph, a page at a time with Previous and Next, and CSV export of every row.
 * Pages are read as they're first opened and kept, so Previous doesn't read again; the count shows once
 * the last page has been read.
 */
import type { history } from "@liberta-labs/bazaar-sdk";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { explain } from "../lib/errors";
import { reloadSize } from "../lib/historySync";
import { downloadCsv, toCsv } from "../lib/csv";
import type { SortValue } from "../lib/sort";
import { useSort } from "../state/sort";
import { ACCOUNT_PAGE, Pager, pageSummary } from "./Pager";
import { TableTools } from "./TableTools";
import { Empty, Loading } from "./ui";

export interface HistoryColumn<T> {
  readonly header: ReactNode;
  readonly csvHeader: string;
  readonly cell: (row: T) => ReactNode;
  readonly csv: (row: T) => string | number | boolean | null | undefined;
  readonly num?: boolean;
  /** What the column sorts by when its header is clicked; a column without one (an untitled one) doesn't sort. */
  readonly sort?: (row: T) => SortValue;
}

/**
 * A column's CSV value as a sort key: a number where it reads as one (amounts, sizes, ids), else the
 * text itself (ISO times sort in time order as text), and nothing for an empty cell.
 */
function byCsv<T>(csv: HistoryColumn<T>["csv"]) {
  return (row: T): SortValue => {
    const v = csv(row);
    if (v === null || v === undefined || v === "") return null;
    if (typeof v !== "string") return v;
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  };
}

/** Reads one page may take: a read can bring back fewer rows than it asks for (fills grouped by order, lists merged by time). */
const MAX_READS_PER_PAGE = 10;
const EXPORT_PAGE = 1000;
const EXPORT_MAX_PAGES = 50;

export function HistoryList<T>({
  load,
  columns,
  empty,
  filename,
  deps,
  pageSize = ACCOUNT_PAGE,
  refreshKey,
}: {
  load: (opts: { first: number; after: string | null }) => Promise<history.Page<T>>;
  columns: readonly HistoryColumn<T>[];
  empty: { title: string; text?: string };
  filename: string;
  deps: readonly unknown[];
  /** Rows a page shows ({@link ACCOUNT_PAGE} unless set). */
  pageSize?: number;
  /**
   * When this changes, the list reloads in place: as many rows as it has read, on the same page, with no
   * spinner, keeping what it had if the reload fails. The account's tables pass `historyVersion`, so what
   * the user just did shows up on its own.
   */
  refreshKey?: unknown;
}) {
  // Every row read so far, newest first, and where the next read starts (null once the last is in).
  const [rows, setRows] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // Each read that replaces the rows takes a new number; a page that lands after one is dropped.
  const generation = useRef(0);
  const shown = useRef(0);
  shown.current = rows.length;

  /**
   * Reads on from `cursor` until `items` holds `need` rows or the list ends. Null when a newer read has
   * replaced the rows meanwhile.
   */
  const fill = async (items: T[], cursor: string | null, need: number, g: number): Promise<{ items: T[]; next: string | null } | null> => {
    for (let i = 0; i < MAX_READS_PER_PAGE && cursor !== null && items.length < need; i++) {
      const p = await load({ first: pageSize, after: cursor });
      if (g !== generation.current) return null;
      items = [...items, ...p.items];
      cursor = p.next;
    }
    return { items, next: cursor };
  };

  const first = useCallback(async () => {
    const g = ++generation.current;
    setLoading(true);
    try {
      const p = await load({ first: pageSize, after: null });
      if (g !== generation.current) return;
      const full = await fill(p.items, p.next, pageSize, g);
      if (!full) return;
      setRows(full.items);
      setNext(full.next);
      setPage(0);
      setError(null);
    } catch (e) {
      if (g === generation.current) setError(explain(e));
    } finally {
      if (g === generation.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void first();
  }, [first]);

  // A reload asked for by `refreshKey`; not on mount, where `first` has just read.
  const keyAtMount = useRef(refreshKey);
  useEffect(() => {
    if (Object.is(refreshKey, keyAtMount.current)) return;
    keyAtMount.current = refreshKey;
    const g = ++generation.current;
    load({ first: reloadSize(shown.current, pageSize), after: null })
      .then((p) => {
        if (g !== generation.current) return;
        setRows(p.items);
        setNext(p.next);
        setError(null);
        setLoading(false);
      })
      .catch(() => {
        // Keep what is shown; Refresh is there to try again.
        if (g === generation.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  /** Opens page `to` (from 0), reading it first if it hasn't been. */
  const go = async (to: number) => {
    if (to < 0) return;
    const need = (to + 1) * pageSize;
    if (rows.length >= need || next === null) {
      setPage(to);
      return;
    }
    const g = generation.current;
    setLoading(true);
    try {
      const full = await fill(rows, next, need, g);
      if (!full) return;
      setRows(full.items);
      setNext(full.next);
      if (full.items.length > to * pageSize) setPage(to);
    } catch (e) {
      if (g === generation.current) setError(explain(e));
    } finally {
      if (g === generation.current) setLoading(false);
    }
  };

  const exportAll = async () => {
    setExporting(true);
    try {
      const all: T[] = [];
      let after: string | null = null;
      for (let i = 0; i < EXPORT_MAX_PAGES; i++) {
        const p: history.Page<T> = await load({ first: EXPORT_PAGE, after });
        all.push(...p.items);
        if (!p.next) break;
        after = p.next;
      }
      downloadCsv(filename, toCsv(all, columns.map((c) => ({ header: c.csvHeader, value: c.csv }))));
    } catch (e) {
      setError(explain(e));
    } finally {
      setExporting(false);
    }
  };

  // Every titled column sorts: by its own key where it has one, else by its CSV value.
  const sortOf = (c: HistoryColumn<T>) => c.sort ?? (c.header ? byCsv(c.csv) : undefined);
  const keys = Object.fromEntries(columns.flatMap((c, i) => (sortOf(c) ? [[String(i), sortOf(c)!]] : [])));
  // The page shown; a list that shrinks on a reload keeps to a page that exists.
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const at = Math.min(page, pages - 1);
  const onPage = rows.slice(at * pageSize, (at + 1) * pageSize);
  const hasNext = at < pages - 1 || next !== null;
  const { sorted, th, sorting } = useSort(onPage, keys);

  if (loading && !rows.length) return <Loading />;
  if (error && !rows.length) return <Empty title={error} action={<button onClick={() => void first()}>Try again</button>} />;
  if (!rows.length) return <Empty title={empty.title}>{empty.text}</Empty>;
  return (
    <>
      <TableTools>
        <button className="small" onClick={() => void exportAll()} disabled={exporting}>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
        <button className="small ghost" onClick={() => void first()}>
          Refresh
        </button>
      </TableTools>
      {/* A sort orders the page shown: the rows past it haven't all been read. */}
      {sorting && (at > 0 || hasNext) && <p className="small muted table-note">Sorted within this page.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {columns.map((c, i) =>
                sortOf(c) ? (
                  <th key={i} {...th(String(i), c.num ? "num" : "")}>
                    {c.header}
                  </th>
                ) : (
                  <th key={i} className={c.num ? "num" : ""}>
                    {c.header}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={i}>
                {columns.map((c, j) => (
                  <td key={j} className={c.num ? "num" : ""}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="down small">{error}</p>}
      <Pager
        page={at}
        hasNext={hasNext}
        onPage={(p) => void go(p)}
        busy={loading}
        summary={`${pageSummary(at, pageSize, onPage.length, next === null ? rows.length : null)}${loading ? " · loading…" : ""}`}
      />
    </>
  );
}
