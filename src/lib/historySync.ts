/**
 * When the account's history tables reload on their own. History comes from the subgraph, which
 * trails the chain by a few seconds, so a table that reloaded the moment the account changed would
 * come back without the change. The service measures that trail every two minutes and publishes it
 * on the board; a table waits for it, plus a margin, then reloads once.
 */

/** The subgraph's usual trail on Arbitrum, for when the board does not say. */
const USUAL_LAG_SECONDS = 5;
/** Added to the trail, which is measured only every two minutes and moves in between. */
const MARGIN_MS = 4_000;
export const MIN_SETTLE_MS = 6_000;
export const MAX_SETTLE_MS = 60_000;
/** How much longer than one wait a run of changes (a bot trading every few seconds) can hold a reload back. */
export const MAX_DEFER_MS = 30_000;
/** The most rows the subgraph returns to one query. */
const SUBGRAPH_MAX_FIRST = 1_000;

/** How long after a change the subgraph should have it: its trail as the board last saw it, plus a margin. */
export function settleMs(secondsBehind: number | null): number {
  const lag = secondsBehind !== null && Number.isFinite(secondsBehind) && secondsBehind >= 0 ? secondsBehind : USUAL_LAG_SECONDS;
  return Math.min(MAX_SETTLE_MS, Math.max(MIN_SETTLE_MS, lag * 1000 + MARGIN_MS));
}

/**
 * The wait before reloading, judged at a change at `now` (ms) when the first change not yet reloaded
 * came at `since`. Each change starts the wait again, so a burst reloads once, after its last change;
 * a run that never pauses still reloads by `MAX_DEFER_MS` past the first change's wait.
 */
export function reloadIn(now: number, since: number, settle: number): number {
  return Math.max(0, Math.min(settle, since + settle + MAX_DEFER_MS - now));
}

/** The rows a reload asks for: as many as the table has read, so the pages already opened stay. */
export function reloadSize(shown: number, pageSize: number): number {
  return Math.min(SUBGRAPH_MAX_FIRST, Math.max(pageSize, shown));
}
