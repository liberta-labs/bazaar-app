import { describe, expect, it } from "vitest";
import { compareValues, firstDir, nextSort, nextSortFrom, sortRows } from "../src/lib/sort";

describe("compareValues", () => {
  it("compares amounts as bigints, numbers alongside, and text without case", () => {
    expect(compareValues(10n ** 30n, 10n ** 30n + 1n)).toBe(-1);
    expect(compareValues(2n, 1.5)).toBe(1);
    expect(compareValues("btc/usd", "BTC/USD")).toBe(0);
    expect(compareValues("TSM", "MSTR")).toBeGreaterThan(0);
    expect(compareValues("Order 9", "Order 10")).toBeLessThan(0);
    expect(compareValues(false, true)).toBe(-1);
  });
});

describe("sortRows", () => {
  const rows = [
    { id: "a", v: 3n },
    { id: "b", v: null },
    { id: "c", v: 1n },
    { id: "d", v: 3n },
  ];
  it("orders both ways, keeps equals in place, and puts rows without a value last", () => {
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.id)).toEqual(["c", "a", "d", "b"]);
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.id)).toEqual(["a", "d", "c", "b"]);
  });
});

describe("firstDir and nextSort", () => {
  it("starts amounts biggest first and text A to Z", () => {
    expect(firstDir([{ v: null }, { v: 2n }], (r) => r.v)).toBe("desc");
    expect(firstDir([{ v: "BTC" }], (r) => r.v)).toBe("asc");
  });

  it("moves through first direction, the other, then off", () => {
    const a = nextSort(null, "value", "desc");
    expect(a).toEqual({ key: "value", dir: "desc" });
    const b = nextSort(a, "value", "desc");
    expect(b).toEqual({ key: "value", dir: "asc" });
    expect(nextSort(b, "value", "desc")).toBeNull();
    // Another column starts over.
    expect(nextSort(b, "market", "asc")).toEqual({ key: "market", dir: "asc" });
  });
});

describe("nextSortFrom (a table that opens sorted, like the markets page by volume)", () => {
  const volume = { key: "volume", dir: "desc" } as const;

  it("toggles the opening column between its two directions", () => {
    const asc = nextSortFrom(volume, "volume", "desc", volume);
    expect(asc).toEqual({ key: "volume", dir: "asc" });
    expect(nextSortFrom(asc, "volume", "desc", volume)).toEqual(volume);
  });

  it("returns from another column to the opening sort, not the rows' own order", () => {
    const price = nextSortFrom(volume, "price", "desc", volume);
    expect(price).toEqual({ key: "price", dir: "desc" });
    const priceAsc = nextSortFrom(price, "price", "desc", volume);
    expect(priceAsc).toEqual({ key: "price", dir: "asc" });
    expect(nextSortFrom(priceAsc, "price", "desc", volume)).toEqual(volume);
  });

  it("is nextSort for a table that opens unsorted", () => {
    expect(nextSortFrom({ key: "price", dir: "asc" }, "price", "desc", null)).toBeNull();
  });
});
