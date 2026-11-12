/**
 * Realized profit and loss per day, as bars above and below zero (green profit, red loss), with
 * the running total in the tooltip. One series and one axis; the title names it, so no legend.
 */
import { toNumber18 } from "@liberta-labs/bazaar-sdk";
import { useMemo, useState } from "react";
import { shortDate, signedUsd } from "../lib/format";

export interface PnlDay {
  readonly date: number;
  readonly pnl: bigint;
}

const H = 180;
const PAD = { l: 56, r: 8, t: 10, b: 22 };

export function PnlChart({ days }: { days: readonly PnlDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const { bars, ticks, cum, zeroY } = useMemo(() => {
    const vals = days.map((d) => toNumber18(d.pnl));
    const max = Math.max(0, ...vals);
    const min = Math.min(0, ...vals);
    const span = max - min || 1;
    const y = (v: number) => PAD.t + ((max - v) / span) * (H - PAD.t - PAD.b);
    const bw = (W - PAD.l - PAD.r) / Math.max(1, days.length);
    let running = 0n;
    const cum: bigint[] = [];
    const bars = days.map((d, i) => {
      running += d.pnl;
      cum.push(running);
      const v = vals[i]!;
      const top = y(Math.max(0, v));
      const bottom = y(Math.min(0, v));
      return { x: PAD.l + i * bw + 1, w: Math.max(2, bw - 2), top, h: Math.max(1, bottom - top), up: d.pnl >= 0n };
    });
    const ticks = [max, (max + min) / 2, min].map((v) => ({ v, y: y(v) }));
    return { bars, ticks, cum, zeroY: y(0) };
  }, [days]);

  const h = hover !== null ? days[hover] : undefined;
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Realized profit and loss per day" onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y} style={{ stroke: "var(--row-line)" }} />
            <text x={PAD.l - 6} y={t.y + 4} textAnchor="end" fontSize="10" style={{ fill: "var(--muted)" }}>
              {t.v >= 0 ? "" : "-"}${Math.abs(t.v) >= 1000 ? `${(Math.abs(t.v) / 1000).toFixed(1)}k` : Math.abs(t.v).toFixed(0)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={W - PAD.r} y1={zeroY} y2={zeroY} style={{ stroke: "var(--border-strong)" }} />
        {bars.map((b, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
            {/* A hit target taller than the bar. */}
            <rect x={b.x - 1} y={PAD.t} width={b.w + 2} height={H - PAD.t - PAD.b} fill="transparent" />
            <rect x={b.x} y={b.top} width={b.w} height={b.h} rx={Math.min(2, b.w / 2)} style={{ fill: b.up ? "var(--up-fill)" : "var(--down-fill)" }} opacity={hover === null || hover === i ? 1 : 0.5} />
          </g>
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
          <div className={h.pnl >= 0n ? "up" : "down"}>{signedUsd(h.pnl)} that day</div>
          <div>{signedUsd(cum[hover]!)} total</div>
        </div>
      )}
    </div>
  );
}
