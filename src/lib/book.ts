/** Figures the order book shows. */
import { pct } from "./format";

/**
 * The spread as a share of the mid price, worked out on the bigints, with enough places to show a tight
 * one: "0.0014%", "0.105%", "3.69%". A dash for a crossed or empty book.
 */
export function spreadPct(bid: bigint, ask: bigint): string {
  const mid = (bid + ask) / 2n;
  if (mid <= 0n || ask < bid) return "–";
  const f = Number(((ask - bid) * 10n ** 12n) / mid) / 1e12;
  return pct(f, f < 0.0001 ? 4 : f < 0.01 ? 3 : 2);
}
