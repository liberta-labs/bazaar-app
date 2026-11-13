/**
 * Sorting a table by a column: the values each column sorts by, the order a click moves through, and
 * the sort itself. Amounts are bigints and compare as bigints, never through floats.
 */

export type SortValue = string | number | bigint | boolean | null | undefined;
export type SortDir = "asc" | "desc";
export interface SortState {
  readonly key: string;
  readonly dir: SortDir;
}

const empty = (v: SortValue) => v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));

/** Two values of a column: numbers and bigints by size (mixed freely), text without case, false before true. */
export function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  if ((typeof a === "bigint" || typeof a === "number") && (typeof b === "bigint" || typeof b === "number")) {
    if (typeof a === "bigint" && typeof b === "bigint") return a < b ? -1 : a > b ? 1 : 0;
    const x = typeof a === "bigint" ? Number(a) : a;
    const y = typeof b === "bigint" ? Number(b) : b;
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return String(a).localeCompare(String(b));
}

/** The rows ordered by `value`, keeping the original order among equals; rows without a value go last either way. */
export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((a, b) => {
      const ea = empty(a.v);
      const eb = empty(b.v);
      if (ea || eb) return ea === eb ? a.i - b.i : ea ? 1 : -1;
      return sign * compareValues(a.v, b.v) || a.i - b.i;
    })
    .map((x) => x.row);
}

/** Where a column's sort starts: the biggest first for amounts, A to Z for text. */
export function firstDir<T>(rows: readonly T[], value: (row: T) => SortValue): SortDir {
  for (const r of rows) {
    const v = value(r);
    if (!empty(v)) return typeof v === "string" ? "asc" : "desc";
  }
  return "desc";
}

/** A click on a column's header: its first direction, then the other, then back to the table's own order. */
export function nextSort(cur: SortState | null, key: string, first: SortDir): SortState | null {
  if (!cur || cur.key !== key) return { key, dir: first };
  if (cur.dir === first) return { key, dir: first === "asc" ? "desc" : "asc" };
  return null;
}
