/** A paginated history list from the subgraph, with CSV export of every page. */
import type { history } from "@liberta-labs/bazaar-sdk";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { explain } from "../lib/errors";
import { downloadCsv, toCsv } from "../lib/csv";
import type { SortValue } from "../lib/sort";
import { useSort } from "../state/sort";
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

const PAGE = 50;
const EXPORT_PAGE = 1000;
const EXPORT_MAX_PAGES = 50;

export function HistoryList<T>({
  load,
  columns,
  empty,
  filename,
  deps,
}: {
  load: (opts: { first: number; after: string | null }) => Promise<history.Page<T>>;
  columns: readonly HistoryColumn<T>[];
  empty: { title: string; text?: string };
  filename: string;
  deps: readonly unknown[];
}) {
  const [rows, setRows] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const first = useCallback(async () => {
    setLoading(true);
    try {
      const p = await load({ first: PAGE, after: null });
      setRows(p.items);
      setNext(p.next);
      setError(null);
    } catch (e) {
      setError(explain(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void first();
  }, [first]);

  const more = async () => {
    if (!next) return;
    setLoading(true);
    try {
      const p = await load({ first: PAGE, after: next });
      setRows((r) => [...r, ...p.items]);
      setNext(p.next);
    } catch (e) {
      setError(explain(e));
    } finally {
      setLoading(false);
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
  const { sorted, th, sorting } = useSort(rows, keys);

  if (loading && !rows.length) return <Loading />;
  if (error && !rows.length) return <Empty title={error} action={<button onClick={() => void first()}>Try again</button>} />;
  if (!rows.length) return <Empty title={empty.title}>{empty.text}</Empty>;
  return (
    <>
      <div className="row" style={{ justifyContent: "flex-end", padding: "8px 10px" }}>
        {/* Sorting orders what has loaded; a page loaded later joins the same order. */}
        {sorting && next && <span className="small muted grow">Sorted within the {rows.length} rows loaded. Load more to include older ones.</span>}
        <button className="small" onClick={() => void exportAll()} disabled={exporting}>
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
        <button className="small ghost" onClick={() => void first()}>
          Refresh
        </button>
      </div>
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
      {next && (
        <div className="row" style={{ justifyContent: "center", padding: 10 }}>
          <button onClick={() => void more()} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </>
  );
}
