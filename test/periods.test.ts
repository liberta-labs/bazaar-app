import { describe, expect, it } from "vitest";
import { ytdDays } from "../src/lib/periods";

const at = (iso: string) => Date.parse(iso) / 1000;

describe("ytdDays", () => {
  it("counts the UTC days from 1 January to today, both included", () => {
    expect(ytdDays(at("2026-01-01T00:00:00Z"))).toBe(1);
    expect(ytdDays(at("2026-01-01T23:59:59Z"))).toBe(1);
    expect(ytdDays(at("2026-02-01T12:00:00Z"))).toBe(32);
    expect(ytdDays(at("2026-11-15T03:00:00Z"))).toBe(319);
    // A leap year's last day.
    expect(ytdDays(at("2028-12-31T18:00:00Z"))).toBe(366);
  });
});
