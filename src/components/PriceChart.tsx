/**
 * The price chart: TradingView Lightweight Charts (Apache 2.0). Its licence asks for credit to
 * TradingView, which the attribution logo gives (layout.attributionLogo, on by default and kept on).
 * Every chart call lives in this one component, so another chart library can replace it.
 */
import { toNumber18 } from "@liberta-labs/bazaar-sdk";
import {
  type AutoscaleInfo,
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineStyle,
  type UTCTimestamp,
  createChart,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { ChartMark } from "../lib/chartMarks";
import { useCssVars, useTheme } from "../state/theme";

export interface ChartCandle {
  readonly time: number;
  readonly open: bigint;
  readonly high: bigint;
  readonly low: bigint;
  readonly close: bigint;
  readonly volume: bigint;
  /** No trades in this period: the previous close carried forward so the time axis has no holes. Drawn faint gray. */
  readonly quiet?: boolean;
}

/** A theme color at half strength, for periods with no trades; as it is when it isn't a plain hex color. */
function faint(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color.trim()) ? `${color.trim()}80` : color;
}

/** The theme's colors, read from its CSS variables: the chart draws on a canvas, which can't use them directly. */
const VARS = ["panel", "row-line", "muted", "border", "up-fill", "down-fill", "up", "down", "strong", "accent", "focus", "volume-up", "volume-down"] as const;

/** The liquidation line's orange: apart from the green and red of orders and the oracle's yellow, on either theme. */
const LIQ_COLOR = "#f0883e";
const MARK_STYLE: Record<ChartMark["style"], LineStyle> = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted };

/**
 * The opening view: candles this many pixels apart (about 100 across a desktop chart, 35 on a phone),
 * the latest one this many candles in from the price axis, so it and the oracle's tag don't sit on it.
 * Double-clicking the time axis comes back to it.
 */
const BAR_SPACING = 10;
const RIGHT_OFFSET = 5;

export function PriceChart({
  candles,
  viewKey,
  oracle,
  precision,
  marks = [],
}: {
  candles: readonly ChartCandle[];
  /** Which candles these are (the market and interval): new ones open on the opening view, the price axis fitting them again. */
  viewKey: string;
  oracle: bigint | null;
  precision: number;
  marks?: readonly ChartMark[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const line = useRef<IPriceLine | null>(null);
  const markLines = useRef(new Map<string, IPriceLine>());
  /** The oracle price as the price axis reads it: always in view, beside the candles. */
  const oracleNum = useRef<number | null>(null);
  /** Set when the candles are another market's or interval's: the next ones open on the opening view. */
  const fresh = useRef(true);
  const c = useCssVars(VARS);
  const { theme } = useTheme();
  // On white the brand yellow is too faint for a thin line: the oracle line takes the darker amber.
  const oracleColor = theme === "light" ? c.focus : c.accent;

  useEffect(() => {
    if (!box.current) return;
    const lines = markLines.current;
    const ch = createChart(box.current, {
      autoSize: true,
      layout: { attributionLogo: true, fontFamily: "Inter, system-ui, sans-serif" },
      timeScale: { timeVisible: true, secondsVisible: false, barSpacing: BAR_SPACING, rightOffset: RIGHT_OFFSET },
      crosshair: { mode: 1 },
      // A vertical swipe scrolls the page, so a phone screen that's mostly chart never traps the reader.
      // Horizontal drags pan the chart and pinches zoom it.
      handleScroll: { vertTouchDrag: false },
    });
    // The price axis fits the candles in view and the oracle price, so the price the market is marked
    // at never sits off screen. Your orders and liquidation price don't count (see the marks below).
    const s = ch.addSeries(CandlestickSeries, {
      autoscaleInfoProvider: (base: () => AutoscaleInfo | null): AutoscaleInfo | null => {
        const fit = base();
        const o = oracleNum.current;
        if (o === null) return fit;
        const r = fit?.priceRange;
        return { ...fit, priceRange: r ? { minValue: Math.min(r.minValue, o), maxValue: Math.max(r.maxValue, o) } : { minValue: o, maxValue: o } };
      },
    });
    // The candles in the top 80%, the volume bars in the bottom 15%: the latest price never runs into them.
    ch.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.2 } });
    // Volume is in the base asset (0.0013 BTC), which the axis label would round to "0": the bars show
    // it, with no label or line of their own.
    const v = ch.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    ch.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    chart.current = ch;
    series.current = s;
    volume.current = v;
    return () => {
      ch.remove();
      chart.current = null;
      series.current = null;
      volume.current = null;
      line.current = null;
      lines.clear();
    };
  }, []);

  // The theme's colors, applied on creation and whenever the theme changes.
  useEffect(() => {
    chart.current?.applyOptions({
      layout: { background: { type: ColorType.Solid, color: c.panel }, textColor: c.muted },
      grid: { vertLines: { color: c["row-line"] }, horzLines: { color: c["row-line"] } },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border },
    });
    series.current?.applyOptions({
      upColor: c["up-fill"],
      downColor: c["down-fill"],
      borderUpColor: c["up-fill"],
      borderDownColor: c["down-fill"],
      wickUpColor: c["up-fill"],
      wickDownColor: c["down-fill"],
    });
  }, [c]);

  useEffect(() => {
    series.current?.applyOptions({ priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision } });
  }, [precision]);

  // Before the candles' effect, so candles that come with a new key open on the opening view.
  useEffect(() => {
    fresh.current = true;
  }, [viewKey]);

  useEffect(() => {
    const s = series.current;
    const v = volume.current;
    if (!s || !v) return;
    // A period with no trades would draw as a green tick at the last price, which reads as trading;
    // faint gray keeps the time axis whole without claiming activity.
    const quiet = faint(c.muted);
    s.setData(
      candles.map((k) => {
        const bar = { time: k.time as UTCTimestamp, open: toNumber18(k.open), high: toNumber18(k.high), low: toNumber18(k.low), close: toNumber18(k.close) };
        return k.quiet ? { ...bar, color: quiet, borderColor: quiet, wickColor: quiet } : bar;
      }),
    );
    v.setData(candles.map((k) => ({ time: k.time as UTCTimestamp, value: toNumber18(k.volume), color: k.quiet ? quiet : k.close >= k.open ? c["volume-up"] : c["volume-down"] })));
    // A market or interval just opened: the latest candles at the opening width, and the price axis
    // fitting them again even if it was dragged on the last one. Updates after that keep your view.
    const ch = chart.current;
    if (ch && fresh.current && candles.length) {
      fresh.current = false;
      const ts = ch.timeScale();
      ts.resetTimeScale();
      // On a quiet market the latest candles can all be flat: the view then reaches back to the last
      // trade, with a sixth of the way to it as margin, clear of the edge and the TradingView logo.
      let traded = candles.length - 1;
      while (traded >= 0 && candles[traded]!.quiet) traded--;
      const view = ts.getVisibleLogicalRange();
      if (view && traded >= 0) {
        const from = traded - Math.max(3, Math.round((view.to - traded) / 6));
        if (from < view.from) ts.setVisibleLogicalRange({ from, to: view.to });
      }
      ch.priceScale("right").applyOptions({ autoScale: true });
    }
  }, [candles, c]);

  useEffect(() => {
    const s = series.current;
    oracleNum.current = oracle === null ? null : toNumber18(oracle);
    if (!s) return;
    if (line.current) {
      s.removePriceLine(line.current);
      line.current = null;
    }
    if (oracle !== null) {
      line.current = s.createPriceLine({ price: toNumber18(oracle), color: oracleColor, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Oracle" });
    }
  }, [oracle, oracleColor]);

  // Your orders and position: each line kept by its key and moved in place, so a fill or an edit
  // doesn't make the others flicker. The price scale fits the candles and the oracle, not these: a far-off order or
  // liquidation price doesn't squash the chart, and shows once you scroll to it.
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    const color = { up: c.up, down: c.down, neutral: c.strong, warn: LIQ_COLOR };
    const lines = markLines.current;
    const seen = new Set<string>();
    for (const m of marks) {
      seen.add(m.key);
      // The line at half strength, so a few of them don't compete with the candles; its tag on the
      // price axis in full color, so it stays readable.
      const opts = {
        price: toNumber18(m.price),
        color: faint(color[m.tone]),
        axisLabelColor: color[m.tone],
        lineWidth: 1 as const,
        lineStyle: MARK_STYLE[m.style],
        axisLabelVisible: true,
        title: m.title,
      };
      const cur = lines.get(m.key);
      if (cur) cur.applyOptions(opts);
      else lines.set(m.key, s.createPriceLine(opts));
    }
    for (const [key, l] of lines) {
      if (seen.has(key)) continue;
      s.removePriceLine(l);
      lines.delete(key);
    }
  }, [marks, c]);

  return <div ref={box} style={{ position: "absolute", inset: 0 }} />;
}
