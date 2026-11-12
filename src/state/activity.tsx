/**
 * Whether anyone is using the page. Everything the page polls (the price board, the chain, the
 * subgraph) and every live watcher stops while it is not, and picks up again at once when it is:
 *
 * - while its tab is hidden (in the background, or the window minimized), and
 * - after {@link IDLE_AFTER_MS} without input (pointer, keyboard, wheel, touch or scroll) in a tab left
 *   open in view. A bar then says updates are paused; any input resumes them.
 *
 * Coming back to a hidden tab counts as input.
 */
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/** Minutes without input after which a visible page stops updating. */
export const IDLE_MINUTES = 15;
export const IDLE_AFTER_MS = IDLE_MINUTES * 60_000;
/** How often the page checks whether it has gone idle. A check costs nothing but a comparison. */
export const IDLE_CHECK_MS = 10_000;

/** Whether a page whose last input was at `lastInput` is idle at `now` (both in ms). */
export const isIdle = (lastInput: number, now: number, after: number = IDLE_AFTER_MS): boolean => now - lastInput >= after;

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

export interface Activity {
  /** The page is visible and in use: poll and watch. */
  readonly active: boolean;
  /** Visible, but no input for {@link IDLE_MINUTES} minutes: updates are paused. */
  readonly idle: boolean;
  readonly visible: boolean;
  /**
   * How many times the page has come back after a pause. A one-off read keyed on it is read again on
   * the way back, so what it shows is not left as it was before the pause.
   */
  readonly resumes: number;
  /** Count as input now: what the "resume" button calls. */
  readonly resume: () => void;
}

const ALWAYS: Activity = { active: true, idle: false, visible: true, resumes: 0, resume: () => {} };

const ActivityCtx = createContext<Activity | null>(null);

const pageVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(pageVisible);
  const [idle, setIdle] = useState(false);
  const [resumes, setResumes] = useState(0);
  const lastInput = useRef(Date.now());
  // Read inside the listeners, which are added once.
  const idleRef = useRef(false);

  const resume = useCallback(() => {
    lastInput.current = Date.now();
    if (idleRef.current) {
      idleRef.current = false;
      setIdle(false);
    }
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      const v = pageVisible();
      setVisible(v);
      if (v) resume();
    };
    const opts = { capture: true, passive: true } as const;
    document.addEventListener("visibilitychange", onVisibility);
    for (const e of INPUT_EVENTS) window.addEventListener(e, resume, opts);
    const check = setInterval(() => {
      if (!idleRef.current && pageVisible() && isIdle(lastInput.current, Date.now())) {
        idleRef.current = true;
        setIdle(true);
      }
    }, IDLE_CHECK_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      for (const e of INPUT_EVENTS) window.removeEventListener(e, resume, opts);
      clearInterval(check);
    };
  }, [resume]);

  const active = visible && !idle;
  // Count each return from a pause (hidden or idle) to active.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) setResumes((n) => n + 1);
    wasActive.current = active;
  }, [active]);

  const value = useMemo(() => ({ active, idle: visible && idle, visible, resumes, resume }), [active, idle, visible, resumes, resume]);
  return <ActivityCtx.Provider value={value}>{children}</ActivityCtx.Provider>;
}

/** The page's activity. Outside an ActivityProvider (a test, say), always active. */
export function useActivity(): Activity {
  return useContext(ActivityCtx) ?? ALWAYS;
}

/** Whether the page should poll and watch now. */
export function usePageActive(): boolean {
  return useActivity().active;
}
