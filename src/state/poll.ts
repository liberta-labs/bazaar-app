/**
 * Polling that stops when nobody is looking. Every subgraph read counts against the query URL's cap,
 * and a forgotten background tab used to poll as hard as the one in front of you.
 */
import { useEffect, useRef, useState } from "react";

/** Whether the page is in view: false while its tab is in the background or its window is minimized. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

/**
 * Runs `load` now and then `everyMs` after each run ends, while `active` and the page is visible. A
 * hidden tab makes no requests; when it is shown again, `load` runs at once if a run fell due meanwhile,
 * else when one falls due. When `deps` change, `load` runs at once. `load` gets `isDead()`, true once
 * `deps` changed, polling paused or the component unmounted: it then must not set state.
 */
export function usePoll(load: (isDead: () => boolean) => Promise<void> | void, everyMs: number, deps: readonly unknown[], active = true): void {
  const visible = usePageVisible();
  const on = active && visible;
  const loadRef = useRef(load);
  loadRef.current = load;
  // When the last run started (ms); 0 makes the next run immediate. Reset by new deps, kept across a pause.
  const last = useRef(0);
  useEffect(() => {
    last.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    if (!on) return;
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      last.current = Date.now();
      try {
        await loadRef.current(() => dead);
      } catch {
        /* the caller reports its own failures; the next run tries again */
      } finally {
        if (!dead) timer = setTimeout(() => void run(), everyMs);
      }
    };
    timer = setTimeout(() => void run(), Math.max(0, last.current + everyMs - Date.now()));
    return () => {
      dead = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, everyMs, ...deps]);
}
