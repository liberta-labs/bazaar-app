/**
 * What icon a market gets, from its Pyth symbol ("Crypto.SOL/USD", "Equity.US.ORCL/USD", "FX.USD/CAD",
 * "Metal.XAU/USD", "Commodities.UKOILSPOT/USD"): a coin's own logo for crypto, a generic symbol for
 * everything else (stocks, FX, metals, energy and other commodities, rates), and the ticker's first
 * letter when nothing is known. Company logos are deliberately not used.
 */

export type AssetKind = "crypto" | "stock" | "fx" | "metal" | "energy" | "commodity" | "rates" | "unknown";

export interface AssetIconSpec {
  readonly kind: AssetKind;
  /** The asset's ticker, upper case: "SOL", "ORCL", "USD" (FX: the base currency), "XAU". */
  readonly ticker: string;
  /** FX: the quote currency ("CAD"); otherwise null. */
  readonly quote: string | null;
}

const CLASSES: Readonly<Record<string, AssetKind>> = {
  crypto: "crypto",
  equity: "stock",
  fx: "fx",
  metal: "metal",
  metals: "metal",
  energy: "energy",
  commodities: "commodity",
  commodity: "commodity",
  rates: "rates",
};

/** Energy tickers Pyth lists under Commodities: oil, gas and the like get the energy symbol. */
const ENERGY = /^(BRENT|WTI|UKOIL|USOIL|CL|NG|NATGAS|HO|RB|GASOLINE|HEATINGOIL|BZ)|OIL|NATGAS/i;
/** Metals sometimes listed under Commodities. */
const METALS = /^(XAU|XAG|XPT|XPD|GOLD|SILVER|PLATINUM|PALLADIUM|COPPER|HG|1OZGOLD)/i;

/**
 * The icon for a market, from its first Pyth leg's symbol (the asset; a composite's second leg is the FX
 * conversion), falling back to the market's label ("SOL/USD") when the symbol is unknown.
 */
export function assetIconSpec(symbol: string | undefined, label: string): AssetIconSpec {
  const sym = (symbol ?? "").trim();
  const m = /^([A-Za-z]+)\.(.+)$/.exec(sym);
  const cls = m ? (CLASSES[m[1]!.toLowerCase()] ?? "unknown") : "unknown";
  // "US.ORCL/USD" -> "ORCL"; "SOL/USD" -> "SOL"; "UKOILSPOT" -> "UKOILSPOT".
  const pair = m ? m[2]! : label;
  const [left = "", right] = pair.split("/");
  const ticker = (left.split(".").pop() ?? left).trim().toUpperCase() || label.split("/")[0]!.trim().toUpperCase();
  const quote = right ? right.trim().toUpperCase() : null;

  let kind: AssetKind = cls;
  if (kind === "commodity" && METALS.test(ticker)) kind = "metal";
  else if (kind === "commodity" && ENERGY.test(ticker)) kind = "energy";
  return { kind, ticker, quote: kind === "fx" ? quote : null };
}

/** A metal's colour: gold, silver, platinum, copper. */
export function metalTone(ticker: string): "gold" | "silver" | "platinum" | "copper" {
  if (/^(XAG|SILVER)/i.test(ticker)) return "silver";
  if (/^(XPT|XPD|PLATINUM|PALLADIUM)/i.test(ticker)) return "platinum";
  if (/^(HG|COPPER)/i.test(ticker)) return "copper";
  return "gold";
}

/** A currency's sign for the FX symbol: "$", "€", "£", "¥"…; null for one without a common sign. */
export function currencySign(code: string | null): string | null {
  const signs: Record<string, string> = {
    USD: "$", CAD: "$", AUD: "$", NZD: "$", HKD: "$", SGD: "$", MXN: "$",
    EUR: "€", GBP: "£", JPY: "¥", CNY: "¥", CNH: "¥", KRW: "₩", INR: "₹", CHF: "₣", TRY: "₺", RUB: "₽", BRL: "R$", ZAR: "R",
  };
  return code ? (signs[code] ?? null) : null;
}
