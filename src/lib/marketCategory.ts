/**
 * Which filter a market falls under on the markets page: Crypto, Stocks, Indices, Commodities, FX or
 * Rates, from the asset class of its Pyth symbol (the same reading its icon takes, lib/assetIcon.ts).
 */
import { assetIconSpec } from "./assetIcon";

export type MarketCategory = "crypto" | "stocks" | "indices" | "commodities" | "fx" | "rates" | "other";

/** The filters in the order they show, each shown only while some market falls under it. */
export const CATEGORIES: readonly { readonly id: MarketCategory; readonly label: string }[] = [
  { id: "crypto", label: "Crypto" },
  { id: "stocks", label: "Stocks" },
  { id: "indices", label: "Indices" },
  { id: "commodities", label: "Commodities" },
  { id: "fx", label: "FX" },
  { id: "rates", label: "Rates" },
  { id: "other", label: "Other" },
];

/** Funds that track a stock index, and index tickers themselves: Indices rather than Stocks. */
const INDEX_TICKERS = /^(SPY|IVV|VOO|VTI|RSP|QQQ|QQQM|DIA|IWM|MDY|SPX|SPX500|US500|NDX|NAS100|US100|DJI|US30|RUT|VIX)$/;

export function marketCategory(market: { readonly legSymbols: readonly string[]; readonly label: string }): MarketCategory {
  const symbol = market.legSymbols[0];
  // A feed Pyth files under an index class ("Index.SPX/USD"), should one be listed.
  if (symbol && /^(index|indices)\./i.test(symbol.trim())) return "indices";
  const spec = assetIconSpec(symbol, market.label);
  switch (spec.kind) {
    case "crypto":
      return "crypto";
    case "stock":
      return INDEX_TICKERS.test(spec.ticker) ? "indices" : "stocks";
    case "metal":
    case "energy":
    case "commodity":
      return "commodities";
    case "fx":
      return "fx";
    case "rates":
      return "rates";
    default:
      return "other";
  }
}
