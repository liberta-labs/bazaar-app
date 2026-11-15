/** The trader page's arithmetic (pages/Trader.tsx), kept apart so it can be tested. */
import type { history } from "@liberta-labs/bazaar-sdk";

const DAY = 86_400;

/**
 * What a trade did to a position, from its size before and after: opened, added to, reduced, closed, or
 * flipped to the other side (an increase that also realized profit or loss closed the old side first).
 * `traded` is the size that changed hands: for a flip, the old side closed plus the new one opened.
 */
export function describeChange(c: Pick<history.PositionChange, "isLong" | "sizeDelta" | "newSize" | "realizedPnl">): { action: string; long: boolean; traded: bigint } {
  const side = c.isLong ? "long" : "short";
  const old = c.newSize - c.sizeDelta;
  if (c.sizeDelta > 0n && old > 0n && c.realizedPnl !== 0n) return { action: `Flip to ${side}`, long: c.isLong, traded: old + c.newSize };
  if (c.sizeDelta > 0n) return { action: old === 0n ? `Open ${side}` : `Add to ${side}`, long: c.isLong, traded: c.sizeDelta };
  if (c.newSize === 0n) return { action: `Close ${side}`, long: c.isLong, traded: -c.sizeDelta };
  return { action: `Reduce ${side}`, long: c.isLong, traded: -c.sizeDelta };
}

/**
 * Realized profit and loss, after fees, over the last `days` UTC days (today counts as one; null for all
 * time), and its running total: zero at the period's start, then the total after each day with a trade.
 */
export function pnlOver(
  days: readonly Pick<history.AccountDayData, "date" | "realizedPnl" | "feesPaid">[],
  span: number | null,
  now: number = Date.now() / 1000,
): { total: bigint; points: { t: number; v: bigint }[] } {
  const today = Math.floor(now / DAY) * DAY;
  const from = span === null ? (days[0]?.date ?? today) : today - (span - 1) * DAY;
  let total = 0n;
  const points = [{ t: from, v: 0n }];
  for (const d of days) {
    if (d.date < from) continue;
    total += d.realizedPnl - d.feesPaid;
    points.push({ t: d.date + DAY, v: total });
  }
  if (points.length === 1) points.push({ t: today + DAY, v: 0n });
  return { total, points };
}
