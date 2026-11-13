/**
 * Export CSV for a table the page already holds in full (balances, positions, open orders, insurance
 * funds): the rows as they stand when it's clicked, in the order shown, with amounts at full precision.
 * The history lists page through the subgraph and export with their own button (History.tsx).
 */
import { type CsvColumn, downloadCsv, toCsv } from "../lib/csv";

export function ExportCsv<T>({ filename, rows, columns }: { filename: string; rows: readonly T[]; columns: readonly CsvColumn<T>[] }) {
  return (
    <button className="small" disabled={!rows.length} onClick={() => downloadCsv(filename, toCsv(rows, columns))}>
      Export CSV
    </button>
  );
}
