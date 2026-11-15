/**
 * A market's icon: the coin's own logo for crypto (from the MIT web3icons set, each file loaded only when
 * shown), the company's logo for a stock simple-icons (CC0) has one for, on a tile of its brand colour,
 * and a generic symbol for other stocks, FX, metals, energy, other commodities and rates, on a tinted
 * tile. Unknown assets, and coins the set lacks, show the ticker's first letter. Decorative: the market's
 * name is always shown beside it.
 */
import type { markets } from "@liberta-labs/bazaar-sdk";
import { useEffect, useState } from "react";
import { type AssetIconSpec, assetIconSpec, currencySign, logoColors, metalTone } from "../lib/assetIcon";
import type { StockLogo, StockLogoFile } from "../lib/stockLogoData";

interface StockLogos {
  /** Logo.dev's logos, downloaded into public/stock-logos by scripts/fetch-stock-logos.mjs. */
  readonly files: Readonly<Record<string, StockLogoFile>>;
  /** simple-icons' marks. */
  readonly marks: Readonly<Record<string, StockLogo>>;
}

// The company logos, one chunk loaded the first time a stock icon is drawn.
let stockLogos: Promise<StockLogos> | null = null;
// Once loaded, kept here too, so an icon drawn later starts with its logo instead of a flash of the tile.
let stockLogosLoaded: StockLogos | null = null;
const loadStockLogos = () => (stockLogos ??= import("../lib/stockLogoData").then((m) => (stockLogosLoaded = { files: m.STOCK_LOGO_FILES, marks: m.STOCK_LOGOS })));

/**
 * A stock's company logo: Logo.dev's when one was downloaded, else simple-icons' mark on a tile of its brand
 * colour; the generic tile until they load, or for good without either.
 */
function StockImage({ ticker, size, fallback }: { ticker: string; size: number; fallback: React.ReactNode }) {
  const [all, setAll] = useState<StockLogos | null>(stockLogosLoaded);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (all) return;
    let dead = false;
    loadStockLogos().then(
      (l) => !dead && setAll(l),
      () => undefined,
    );
    return () => {
      dead = true;
    };
  }, [all]);
  const file = all && Object.hasOwn(all.files, ticker) ? all.files[ticker] : undefined;
  if (file && failed !== ticker) {
    // The etag in the address, so a logo Logo.dev has updated isn't served from an old cached copy.
    const src = `${import.meta.env.BASE_URL}stock-logos/${ticker}.webp?v=${encodeURIComponent(file.etag)}`;
    return <img className={`asset-icon asset-stock-logo${file.transparent ? " on-tile" : ""}`} src={src} width={size} height={size} alt="" aria-hidden="true" onError={() => setFailed(ticker)} />;
  }
  const logo = all && Object.hasOwn(all.marks, ticker) ? all.marks[ticker] : undefined;
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

// The coin icon index (lib/coinIcons.ts), one chunk loaded the first time a coin or unknown asset is drawn.
let coinIcons: Promise<typeof import("../lib/coinIcons")> | null = null;
const loadCoinIcons = () => (coinIcons ??= import("../lib/coinIcons"));
// Icons already loaded, as data: URLs, so an icon drawn again starts with its logo instead of a flash of the tile.
const coinUrls = new Map<string, string>();

/** A coin's logo; the fallback until it loads, or for good when the set lacks the coin. */
function CoinImage({ ticker, size, fallback }: { ticker: string; size: number; fallback: React.ReactNode }) {
  const key = ticker.toUpperCase();
  const [, setLoaded] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (coinUrls.has(key)) return;
    let dead = false;
    loadCoinIcons()
      .then((m) => m.coinIcon(key)?.())
      .then(
        (svg) => {
          if (svg === undefined) return;
          // Drawn by an <img>, so the SVG is shown as a picture and nothing in it runs.
          coinUrls.set(key, `data:image/svg+xml,${encodeURIComponent(svg)}`);
          if (!dead) setLoaded((n) => n + 1);
        },
        () => !dead && setFailed(key),
      );
    return () => {
      dead = true;
    };
  }, [key]);
  const url = coinUrls.get(key);
  if (failed === key || !url) return <>{fallback}</>;
  return <img className="asset-icon asset-coin" src={url} width={size} height={size} alt="" aria-hidden="true" onError={() => setFailed(key)} />;
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
  // A coin the set knows: its logo, else the letter tile. A market whose class is unknown (no Pyth symbol
  // was read) gets the logo too when its ticker is a known coin.
  if (spec.kind === "crypto" || spec.kind === "unknown") {
    return <CoinImage ticker={spec.ticker} size={size} fallback={<Tile spec={{ ...spec, kind: "unknown" }} size={size} />} />;
  }
  if (spec.kind === "stock") return <StockImage ticker={spec.ticker} size={size} fallback={<Tile spec={spec} size={size} />} />;
  return <Tile spec={spec} size={size} />;
}
