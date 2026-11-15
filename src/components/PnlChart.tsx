/**
 * Profit and loss as its running total over the days shown, so a loss stays down until a gain makes it
 * back (the line green above $0, red below, split at the zero line); or volume, each day's own, all above
 * zero in one colour. The tooltip gives the day's own figure and the total so far.
 * The area between the line and zero is shaded lightly in the same colours.
 * One series and one axis; the title names it, so no legend. Hovering a day marks it with a guide line
 * and a dot.
 */
import { toNumber18 } from "@liberta-labs/bazaar-sdk";
import { useId, useMemo, useState } from "react";
import { shortDate, signedUsd, usd } from "../lib/format";

export interface PnlDay {
  readonly date: number;
  readonly pnl: bigint;
}

const H = 180;
const PAD = { l: 56, r: 8, t: 10, b: 22 };
/** Where the P&L line's colour gradient starts and ends: the plot and a margin past it. */
const GRAD_TOP = 0;
const GRAD_BOTTOM = H;
/** How strongly the area under the line is shaded: a light wash of the line's colour. */
const AREA_OPACITY = 0.16;

/** An axis label: "$1.2k", "$35", "$0.25", and no sign on a zero. */
function tickText(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1000 ? `${(a / 1000).toFixed(1)}k` : a >= 10 ? a.toFixed(0) : a >= 0.01 ? a.toFixed(2) : a > 0 ? a.toPrecision(1) : "0";
  return `${v < 0 && s !== "0" ? "-" : ""}$${s}`;
}

export function PnlChart({ days, kind = "pnl" }: { days: readonly PnlDay[]; kind?: "pnl" | "volume" }) {
  const volume = kind === "volume";
  const [hover, setHover] = useState<number | null>(null);
  // The split colour's gradient id: one per chart, without the colons useId puts in, which url() can't take.
  const gradient = `pnl-line-${useId().replace(/:/g, "")}`;
  const W = 640;
  const { points, path, area, step, ticks, cum, zeroY } = useMemo(() => {
    let running = 0n;
    const cum = days.map((d) => (running += d.pnl));
    // Volume per day; profit and loss as the running total, which is where the account stands.
    const vals = (volume ? days.map((d) => d.pnl) : cum).map((v) => toNumber18(v));
    const max = Math.max(0, ...vals);
    const min = Math.min(0, ...vals);
    const span = max - min || 1;
    const y = (v: number) => PAD.t + ((max - v) / span) * (H - PAD.t - PAD.b);
    // The first day at the left edge and the last at the right, under their date labels.
    const step = (W - PAD.l - PAD.r) / Math.max(1, days.length - 1);
    const points = days.map((_, i) => ({ x: days.length === 1 ? (PAD.l + W - PAD.r) / 2 : PAD.l + i * step, y: y(vals[i]!) }));
    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    // The shaded area: down from the line to the zero line and back along it.
    const zeroY = y(0);
    const first = points[0];
    const last = points[points.length - 1];
    const area = first && last ? `${path} L${last.x.toFixed(1)},${zeroY.toFixed(1)} L${first.x.toFixed(1)},${zeroY.toFixed(1)} Z` : "";
    const ticks = [max, (max + min) / 2, min].map((v) => ({ v, y: y(v) }));
    return { points, path, area, step, ticks, cum, zeroY };
  }, [days, volume]);

  // Where the zero line falls down the plot, from 0 (top) to 1 (bottom): the P&L line is green above it,
  // red below, and gray along it, so a day with nothing realized reads as neither.
  // The gradient runs a little past the plot, so a zero line at its top or bottom edge (all losses, or all
  // gains) still sits inside it and keeps its gray band.
  const at = (yy: number) => Math.min(1, Math.max(0, (yy - GRAD_TOP) / (GRAD_BOTTOM - GRAD_TOP)));
  const aboveZero = at(zeroY - 1);
  const belowZero = at(zeroY + 1);
  const stroke = volume ? "var(--accent)" : `url(#${gradient})`;
  // The area's colour splits at the zero line itself: it is green where the line is above it, red below.
  const zeroAt = at(zeroY);
  const fill = volume ? "var(--accent)" : `url(#${gradient}-area)`;
  const h = hover !== null ? days[hover] : undefined;
  const p = hover !== null ? points[hover] : undefined;
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={volume ? "Volume per day" : "Realized profit and loss, running total"} onMouseLeave={() => setHover(null)}>
        {!volume && (
          <defs>
            <linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1="0" y1={GRAD_TOP} x2="0" y2={GRAD_BOTTOM}>
              <stop offset={aboveZero} style={{ stopColor: "var(--up-fill)" }} />
              <stop offset={aboveZero} style={{ stopColor: "var(--muted)" }} />
              <stop offset={belowZero} style={{ stopColor: "var(--muted)" }} />
              <stop offset={belowZero} style={{ stopColor: "var(--down-fill)" }} />
            </linearGradient>
            <linearGradient id={`${gradient}-area`} gradientUnits="userSpaceOnUse" x1="0" y1={GRAD_TOP} x2="0" y2={GRAD_BOTTOM}>
              <stop offset={zeroAt} style={{ stopColor: "var(--up-fill)" }} />
              <stop offset={zeroAt} style={{ stopColor: "var(--down-fill)" }} />
            </linearGradient>
          </defs>
        )}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y} style={{ stroke: "var(--row-line)" }} />
            <text x={PAD.l - 6} y={t.y + 4} textAnchor="end" fontSize="10" style={{ fill: "var(--muted)" }}>
              {tickText(t.v)}
            </text>
          </g>
        ))}
        {points.length > 1 && <path d={area} stroke="none" style={{ fill, fillOpacity: AREA_OPACITY }} />}
        <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} style={{ stroke: "var(--border-strong)" }} />
        {p && <line x1={p.x} x2={p.x} y1={PAD.t} y2={H - PAD.b} style={{ stroke: "var(--border-strong)" }} strokeDasharray="3 3" />}
        {points.length > 1 && <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
        {/* A single day has no line to draw: its dot stands in. */}
        {points.length === 1 && <circle cx={points[0]!.x} cy={points[0]!.y} r={3} style={{ fill: volume ? "var(--accent)" : days[0]!.pnl < 0n ? "var(--down-fill)" : "var(--up-fill)" }} />}
        {p && h && (
          <circle
            cx={p.x}
            cy={p.y}
            r={4}
            strokeWidth={2}
            style={{ fill: volume ? "var(--accent)" : (cum[hover ?? 0] ?? 0n) < 0n ? "var(--down-fill)" : "var(--up-fill)", stroke: "var(--panel)" }}
          />
        )}
        {/* Each day's hit target: the full height of the plot, as wide as the gap between days. */}
        {points.map((pt, i) => (
          <rect
            key={i}
            x={days.length === 1 ? PAD.l : pt.x - step / 2}
            y={PAD.t}
            width={days.length === 1 ? W - PAD.l - PAD.r : step}
            height={H - PAD.t - PAD.b}
            fill="transparent"
            tabIndex={0}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
          />
        ))}
        {days.length > 0 && (
          <>
            <text x={PAD.l} y={H - 6} fontSize="10" style={{ fill: "var(--muted)" }}>
              {shortDate(days[0]!.date)}
            </text>
            <text x={W - PAD.r} y={H - 6} fontSize="10" style={{ fill: "var(--muted)" }} textAnchor="end">
              {shortDate(days[days.length - 1]!.date)}
            </text>
          </>
        )}
      </svg>
      {h && hover !== null && (
        <div className="small" style={{ position: "absolute", top: 4, right: 8, background: "var(--tip-bg)", border: "1px solid var(--tip-border)", boxShadow: "0 6px 18px var(--shadow)", borderRadius: 6, padding: "6px 8px" }}>
          <div className="muted">{shortDate(h.date)}</div>
          {volume ? (
            <>
              <div>{usd(h.pnl)} that day</div>
              <div className="muted">{usd(cum[hover]!)} so far</div>
            </>
          ) : (
            <>
              <div className={h.pnl >= 0n ? "up" : "down"}>{signedUsd(h.pnl)} that day</div>
              <div>{signedUsd(cum[hover]!)} total</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
