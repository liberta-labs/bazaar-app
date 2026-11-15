/** Periods that profit and loss is read over, by UTC day (the Portfolio's account panel, a trader's page). */

const DAY = 86_400;

/** Days from 1 January (UTC) of this year to today, both counted: 1 on New Year's Day. */
export function ytdDays(now: number = Date.now() / 1000): number {
  const today = Math.floor(now / DAY) * DAY;
  const newYear = Date.UTC(new Date(today * 1000).getUTCFullYear(), 0, 1) / 1000;
  return Math.round((today - newYear) / DAY) + 1;
}
