/**
 * A market's icon: the coin's own logo for crypto (from the CC0 cryptocurrency-icons set, each file
 * loaded only when shown), the company's logo for a stock simple-icons (CC0) has one for, on a tile of
 * its brand colour, and a generic symbol for other stocks, FX, metals, energy, other commodities and
 * rates, on a tinted tile. Unknown assets show the ticker's first letter. Decorative: the market's name
 * is always shown beside it.
 */
import type { markets } from "@liberta-labs/bazaar-sdk";
import { useEffect, useState } from "react";
import { type AssetIconSpec, assetIconSpec, currencySign, logoColors, metalTone } from "../lib/assetIcon";
import type { StockLogo } from "../lib/stockLogoData";

// The company logos, one chunk loaded the first time a stock icon is drawn.
let stockLogos: Promise<Readonly<Record<string, StockLogo>>> | null = null;
// Once loaded, kept here too, so an icon drawn later starts with its logo instead of a flash of the tile.
let stockLogosLoaded: Readonly<Record<string, StockLogo>> | null = null;
const loadStockLogos = () =>
  (stockLogos ??= import("../lib/stockLogoData").then((m) => {
    stockLogosLoaded = m.STOCK_LOGOS;
    return m.STOCK_LOGOS;
  }));

/** A stock's company logo on a tile of its brand colour; the generic tile until it loads, or for good without one. */
function StockImage({ ticker, size, fallback }: { ticker: string; size: number; fallback: React.ReactNode }) {
  const [logo, setLogo] = useState<StockLogo | null>(() => stockLogosLoaded?.[ticker] ?? null);
  useEffect(() => {
    let dead = false;
    loadStockLogos().then(
      (all) => !dead && setLogo(all[ticker] ?? null),
      () => undefined,
    );
    return () => {
      dead = true;
    };
  }, [ticker]);
  if (!logo) return <>{fallback}</>;
  const c = logoColors(logo.hex);
  return (
    <span className={`asset-icon asset-tile asset-logo${c.outlined ? " outlined" : ""}`} style={{ width: size, height: size, background: c.tile, color: c.ink }} aria-hidden="true">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d={logo.path} fill="currentColor" />
      </svg>
    </span>
  );
}

// Each coin's SVG as a lazily loaded URL, keyed by its lower-case ticker.
const COIN_URLS: Record<string, () => Promise<string>> = Object.fromEntries(
  Object.entries(import.meta.glob<string>("/node_modules/cryptocurrency-icons/svg/color/*.svg", { query: "?url", import: "default" })).map(([path, load]) => [
    path.slice(path.lastIndexOf("/") + 1, -4),
    load,
  ]),
);

/** Whether the icon set has this coin. */
export const hasCoinIcon = (ticker: string) => ticker.toLowerCase() in COIN_URLS;

function CoinImage({ ticker, size, fallback }: { ticker: string; size: number; fallback: React.ReactNode }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const load = COIN_URLS[ticker.toLowerCase()];
    if (!load) return;
    let dead = false;
    load().then(
      (u) => !dead && setUrl(u),
      () => !dead && setFailed(true),
    );
    return () => {
      dead = true;
    };
  }, [ticker]);
  if (failed || !url) return <>{fallback}</>;
  return <img className="asset-icon" src={url} width={size} height={size} alt="" aria-hidden="true" onError={() => setFailed(true)} />;
}

/** The generic symbol for a non-crypto asset, drawn on a 24×24 grid in the tile's ink colour. */
function Glyph({ spec }: { spec: AssetIconSpec }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (spec.kind) {
    case "stock":
      // A building with columns: an exchange.
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...stroke} d="M4 9.5 12 5l8 4.5M5 19h14M6.5 10.5v6M10 10.5v6M14 10.5v6M17.5 10.5v6" />
        </svg>
      );
    case "fx": {
      const a = currencySign(spec.ticker);
      const b = currencySign(spec.quote);
      const text = a && b && a !== b ? `${a}${b}` : "€$";
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <text x="12" y="16.5" textAnchor="middle" fontSize={text.length > 2 ? 9 : 11} fontWeight={700} fill="currentColor" fontFamily="system-ui, sans-serif">
            {text}
          </text>
        </svg>
      );
    }
    case "metal":
      // Stacked bars.
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...stroke} d="M5 18.5h6l-1-4H6zM13 18.5h6l-1-4h-4zM9 13h6l-1-4h-4z" />
        </svg>
      );
    case "energy":
      // An oil drop.
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...stroke} d="M12 4c-2.8 4-5 6.9-5 9.7a5 5 0 0 0 10 0C17 10.9 14.8 8 12 4z" />
          <path {...stroke} d="M10 14.5a2 2 0 0 0 2 2" />
        </svg>
      );
    case "commodity":
      // An ear of grain.
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...stroke} d="M12 20V8M12 8c-1.5-1-1.5-3 0-4 1.5 1 1.5 3 0 4zM12 12c-2-.2-3.3-1.6-3.5-3.5 2 .2 3.3 1.6 3.5 3.5zM12 12c2-.2 3.3-1.6 3.5-3.5-2 .2-3.3 1.6-3.5 3.5zM12 16c-2-.2-3.3-1.6-3.5-3.5 2 .2 3.3 1.6 3.5 3.5zM12 16c2-.2 3.3-1.6 3.5-3.5-2 .2-3.3 1.6-3.5 3.5z" />
        </svg>
      );
    case "rates":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path {...stroke} d="M17 7 7 17" />
          <circle {...stroke} cx="8" cy="8" r="1.8" />
          <circle {...stroke} cx="16" cy="16" r="1.8" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <text x="12" y="16.5" textAnchor="middle" fontSize={12} fontWeight={700} fill="currentColor" fontFamily="system-ui, sans-serif">
            {spec.ticker.charAt(0) || "?"}
          </text>
        </svg>
      );
  }
}

function Tile({ spec, size }: { spec: AssetIconSpec; size: number }) {
  const tone = spec.kind === "metal" ? ` metal-${metalTone(spec.ticker)}` : "";
  return (
    <span className={`asset-icon asset-tile asset-${spec.kind}${tone}`} style={{ width: size, height: size }} aria-hidden="true">
      <Glyph spec={spec} />
    </span>
  );
}

/** The icon for a market, `size` pixels square. */
export function AssetIcon({ market, size = 20 }: { market: Pick<markets.MarketInfo, "label" | "legSymbols">; size?: number }) {
  const spec = assetIconSpec(market.legSymbols[0], market.label);
  // A coin the set knows: its logo. A market whose class is unknown but whose ticker is a known coin
  // (no Pyth symbol was read) gets the logo too.
  if (spec.kind === "crypto" || (spec.kind === "unknown" && hasCoinIcon(spec.ticker))) {
    const fallback = <Tile spec={{ ...spec, kind: "unknown" }} size={size} />;
    return hasCoinIcon(spec.ticker) ? <CoinImage ticker={spec.ticker} size={size} fallback={fallback} /> : fallback;
  }
  if (spec.kind === "stock") return <StockImage ticker={spec.ticker} size={size} fallback={<Tile spec={spec} size={size} />} />;
  return <Tile spec={spec} size={size} />;
}
