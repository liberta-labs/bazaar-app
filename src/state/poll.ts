/**
 * Polling that stops when nobody is using the page: while its tab is hidden, and after 15 minutes
 * without input (activity.tsx). Every read costs someone (the service's bandwidth, the RPC's rate,
 * the subgraph's queries), and a forgotten tab used to poll as hard as the one in front of you.
 */
import { useEffect, useRef } from "react";
import { usePageActive } from "./activity";

/**
 * Runs `load` now and then `everyMs` after each run ends, while `active` and the page is in use. A
 * paused page makes no requests; when it is used again, `load` runs at once if a run fell due
 * meanwhile, else when one falls due. When `deps` change, `load` runs at once. `load` gets `isDead()`,
 * true once `deps` changed, polling paused or the component unmounted: it then must not set state.
 */
export function usePoll(load: (isDead: () => boolean) => Promise<void> | void, everyMs: number, deps: readonly unknown[], active = true): void {
  const inUse = usePageActive();
  const on = active && inUse;
  const loadRef = useRef(load);
  loadRef.current = load;
  // When the last run started, on the monotonic clock (ms), which a change to the system clock cannot
  // move; -Infinity makes the next run immediate. Reset by new deps, kept across a pause.
  const last = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    last.current = Number.NEGATIVE_INFINITY;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    if (!on) return;
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      last.current = performance.now();
      try {
        await loadRef.current(() => dead);
      } catch {
        /* the caller reports its own failures; the next run tries again */
      } finally {
        if (!dead) timer = setTimeout(() => void run(), everyMs);
      }
    };
    timer = setTimeout(() => void run(), Math.max(0, last.current + everyMs - performance.now()));
    return () => {
      dead = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, everyMs, ...deps]);
}
