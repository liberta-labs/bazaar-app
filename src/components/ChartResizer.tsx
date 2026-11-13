/**
 * The bar under the chart and the order book: drag it to make both taller or shorter, and the account
 * tabs below follow; click it to go back to the default height. Arrow keys move it too (Shift for bigger
 * steps), Home or Enter resets it. The height is a per-viewer convenience, kept in this browser.
 *
 * While dragging, only the grid's --chart-h changes (no React render per pixel); the height is committed
 * when the drag ends.
 */
import { type RefObject, useRef, useState } from "react";

const KEY = "bazaar.chartHeight";
export const CHART_HEIGHT_DEFAULT = 560;
const MIN = 320;
const MAX = 1400;
/** Movement under this many pixels is a click, which resets. */
const CLICK_SLOP = 3;

const clamp = (v: number) => Math.round(Math.min(MAX, Math.max(MIN, v)));

function readStored(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? clamp(v) : CHART_HEIGHT_DEFAULT;
  } catch {
    return CHART_HEIGHT_DEFAULT;
  }
}

function store(v: number) {
  try {
    if (v === CHART_HEIGHT_DEFAULT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(v));
  } catch {
    /* storage blocked: the height lasts until the page reloads */
  }
}

/** The chart and book height, as last left in this browser. */
export function useChartHeight(): [number, (h: number) => void] {
  const [h, setH] = useState(readStored);
  return [
    h,
    (v: number) => {
      setH(v);
      store(v);
    },
  ];
}

export function ChartResizer({ target, height, onChange }: { target: RefObject<HTMLElement | null>; height: number; onChange: (h: number) => void }) {
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const [active, setActive] = useState(false);
  const apply = (h: number) => target.current?.style.setProperty("--chart-h", `${h}px`);
  const commit = (h: number) => {
    apply(h);
    onChange(h);
  };
  return (
    <div
      className={`t-resize${active ? " on" : ""}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Chart and order book height"
      aria-valuenow={height}
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      tabIndex={0}
      title="Drag to resize the chart and order book. Click to reset to the default height."
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, h: height, moved: false };
        setActive(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dy = e.clientY - d.y;
        if (Math.abs(dy) > CLICK_SLOP) d.moved = true;
        if (d.moved) apply(clamp(d.h + dy));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        setActive(false);
        if (d) commit(d.moved ? clamp(d.h + e.clientY - d.y) : CHART_HEIGHT_DEFAULT);
      }}
      onPointerCancel={() => {
        const d = drag.current;
        drag.current = null;
        setActive(false);
        if (d) apply(d.h);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 80 : 20;
        const next = e.key === "ArrowUp" ? clamp(height - step) : e.key === "ArrowDown" ? clamp(height + step) : e.key === "Home" || e.key === "Enter" ? CHART_HEIGHT_DEFAULT : null;
        if (next === null) return;
        e.preventDefault();
        commit(next);
      }}
    >
      <span className="t-resize-grip" />
    </div>
  );
}
