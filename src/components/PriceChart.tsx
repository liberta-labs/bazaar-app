/**
 * The price chart: TradingView Lightweight Charts (Apache 2.0). Its licence asks for credit to
 * TradingView, which the attribution logo gives (layout.attributionLogo, on by default and kept on).
 * Every chart call lives in this one component, so another chart library can replace it.
 */
import { toNumber18 } from "@liberta-labs/bazaar-sdk";
import {
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
import { useCssVars, useTheme } from "../state/theme";

export interface ChartCandle {
  readonly time: number;
  readonly open: bigint;
  readonly high: bigint;
  readonly low: bigint;
  readonly close: bigint;
  readonly volume: bigint;
}

/** The theme's colors, read from its CSS variables: the chart draws on a canvas, which can't use them directly. */
const VARS = ["panel", "row-line", "muted", "border", "up-fill", "down-fill", "accent", "focus", "volume-up", "volume-down"] as const;

export function PriceChart({ candles, oracle, precision }: { candles: readonly ChartCandle[]; oracle: bigint | null; precision: number }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const line = useRef<IPriceLine | null>(null);
  const c = useCssVars(VARS);
  const { theme } = useTheme();
  // On white the brand yellow is too faint for a thin line: the oracle line takes the darker amber.
  const oracleColor = theme === "light" ? c.focus : c.accent;

  useEffect(() => {
    if (!box.current) return;
    const ch = createChart(box.current, {
      autoSize: true,
      layout: { attributionLogo: true, fontFamily: "Inter, system-ui, sans-serif" },
      timeScale: { timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
      // A vertical swipe scrolls the page, so a phone screen that's mostly chart never traps the reader.
      // Horizontal drags pan the chart and pinches zoom it.
      handleScroll: { vertTouchDrag: false },
    });
    const s = ch.addSeries(CandlestickSeries, {});
    const v = ch.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol" });
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

  useEffect(() => {
    const s = series.current;
    const v = volume.current;
    if (!s || !v) return;
    s.setData(
      candles.map((k) => ({ time: k.time as UTCTimestamp, open: toNumber18(k.open), high: toNumber18(k.high), low: toNumber18(k.low), close: toNumber18(k.close) })),
    );
    v.setData(candles.map((k) => ({ time: k.time as UTCTimestamp, value: toNumber18(k.volume), color: k.close >= k.open ? c["volume-up"] : c["volume-down"] })));
  }, [candles, c]);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    if (line.current) {
      s.removePriceLine(line.current);
      line.current = null;
    }
    if (oracle !== null) {
      line.current = s.createPriceLine({ price: toNumber18(oracle), color: oracleColor, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Oracle" });
    }
  }, [oracle, oracleColor]);

  return <div ref={box} style={{ position: "absolute", inset: 0 }} />;
}
