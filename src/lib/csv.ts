/** CSV export of history tables, built in the browser and saved as a file. */

export interface CsvColumn<T> {
  readonly header: string;
  readonly value: (row: T) => string | number | boolean | null | undefined;
}

const cell = (v: string | number | boolean | null | undefined): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Quote anything with a separator, a quote or a line break; neutralize spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r))).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
