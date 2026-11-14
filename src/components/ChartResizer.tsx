/**
 * The market window's two drag bars. The one under it makes the chart and the book taller or shorter,
 * and the account tabs below follow; the one between the chart and the book moves that line, so one
 * gets wider as the other narrows. Click a bar to go back to its default; arrow keys move it too (Shift
 * for bigger steps), Home or Enter resets it. Each size is a per-viewer convenience, kept in this browser.
 *
 * While dragging, only the grid's CSS variable changes (no React render per pixel); the size is
 * committed when the drag ends.
 */
import { type RefObject, useRef, useState } from "react";

interface Size {
  /** Where this browser keeps it. */
  readonly key: string;
  /** The CSS variable on the market grid that carries it. */
  readonly cssVar: string;
  readonly fallback: number;
  readonly min: number;
  readonly max: number;
}

const CHART_HEIGHT: Size = { key: "bazaar.chartHeight", cssVar: "--chart-h", fallback: 560, min: 320, max: 1400 };
const BOOK_WIDTH: Size = { key: "bazaar.bookWidth", cssVar: "--book-w", fallback: 300, min: 240, max: 560 };
export const CHART_HEIGHT_DEFAULT = CHART_HEIGHT.fallback;
export const BOOK_WIDTH_DEFAULT = BOOK_WIDTH.fallback;
/** Movement under this many pixels is a click, which resets. */
const CLICK_SLOP = 3;

const clampTo = (s: Size, v: number) => Math.round(Math.min(s.max, Math.max(s.min, v)));

function readStored(s: Size): number {
  try {
    const v = Number(localStorage.getItem(s.key));
    return Number.isFinite(v) && v > 0 ? clampTo(s, v) : s.fallback;
  } catch {
    return s.fallback;
  }
}

function store(s: Size, v: number) {
  try {
    if (v === s.fallback) localStorage.removeItem(s.key);
    else localStorage.setItem(s.key, String(v));
  } catch {
    /* storage blocked: the size lasts until the page reloads */
  }
}

function useStoredSize(s: Size): [number, (v: number) => void] {
  const [v, setV] = useState(() => readStored(s));
  return [
    v,
    (n: number) => {
      setV(n);
      store(s, n);
    },
  ];
}

/** The chart and book height, as last left in this browser. */
export const useChartHeight = () => useStoredSize(CHART_HEIGHT);
/** The book's width beside the chart, as last left in this browser. */
export const useBookWidth = () => useStoredSize(BOOK_WIDTH);

interface ResizerProps {
  target: RefObject<HTMLElement | null>;
  value: number;
  onChange: (v: number) => void;
}

function Resizer({
  size,
  axis,
  className,
  label,
  title,
  target,
  value,
  onChange,
}: ResizerProps & {
  size: Size;
  /** "y": dragging down grows it. "x": dragging left grows it (the book, right of the bar). */
  axis: "x" | "y";
  className: string;
  label: string;
  title: string;
}) {
  const drag = useRef<{ at: number; v: number; moved: boolean } | null>(null);
  const [active, setActive] = useState(false);
  const clamp = (v: number) => clampTo(size, v);
  const apply = (v: number) => target.current?.style.setProperty(size.cssVar, `${v}px`);
  const commit = (v: number) => {
    apply(v);
    onChange(v);
  };
  const pos = (e: { clientX: number; clientY: number }) => (axis === "y" ? e.clientY : e.clientX);
  const grow = (d: { at: number; v: number }, e: { clientX: number; clientY: number }) => clamp(d.v + (axis === "y" ? pos(e) - d.at : d.at - pos(e)));
  // Keys follow the bar on screen: down or right moves it that way.
  const keys = axis === "y" ? { less: "ArrowUp", more: "ArrowDown" } : { less: "ArrowRight", more: "ArrowLeft" };
  return (
    <div
      className={`${className}${active ? " on" : ""}`}
      role="separator"
      aria-orientation={axis === "y" ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={size.min}
      aria-valuemax={size.max}
      tabIndex={0}
      title={title}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { at: pos(e), v: value, moved: false };
        setActive(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (Math.abs(pos(e) - d.at) > CLICK_SLOP) d.moved = true;
        if (d.moved) apply(grow(d, e));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        setActive(false);
        if (d) commit(d.moved ? grow(d, e) : size.fallback);
      }}
      onPointerCancel={() => {
        const d = drag.current;
        drag.current = null;
        setActive(false);
        if (d) apply(d.v);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 80 : 20;
        const next = e.key === keys.less ? clamp(value - step) : e.key === keys.more ? clamp(value + step) : e.key === "Home" || e.key === "Enter" ? size.fallback : null;
        if (next === null) return;
        e.preventDefault();
        commit(next);
      }}
    >
      <span className="t-resize-grip" />
    </div>
  );
}

/** The bar under the market window: the chart and book height. */
export function ChartResizer({ target, height, onChange }: { target: RefObject<HTMLElement | null>; height: number; onChange: (h: number) => void }) {
  return (
    <Resizer
      size={CHART_HEIGHT}
      axis="y"
      className="t-resize"
      label="Chart and order book height"
      title="Drag to resize the chart and order book. Click to reset to the default height."
      target={target}
      value={height}
      onChange={onChange}
    />
  );
}

/** The bar between the chart and the book: the book's width, and so the chart's. */
export function BookResizer({ target, width, onChange }: { target: RefObject<HTMLElement | null>; width: number; onChange: (w: number) => void }) {
  return (
    <Resizer
      size={BOOK_WIDTH}
      axis="x"
      className="t-resize-x"
      label="Order book width"
      title="Drag to make the chart wider or the order book wider. Click to reset to the default width."
      target={target}
      value={width}
      onChange={onChange}
    />
  );
}
