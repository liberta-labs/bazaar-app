/**
 * The name of what a market trades ("NVIDIA Corp", "Bitcoin"), for under its ticker. Taken from the
 * market's listing description, which UMA's voters checked names the asset, in either style proposers
 * write it: "Equity.US.NVDA/USD NVIDIA Corp" (Pyth's symbol, then the name) or "Starbucks Corporation /
 * US Dollar, SBUX/USD, Pyth Pro feed 1384" (the name first). A description that gives nothing past the
 * ticker falls back to Pyth's registry entry ("NVIDIA CORP / US DOLLAR"), tidied. Text from the chain
 * and Pyth: shown as text only.
 */

/** "NVIDIA CORP" → "Nvidia Corp"; text that isn't all capitals is left as written. */
function tidyCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s\-(./&])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/** The asset's name from a description, or null when it names nothing past the ticker. */
function fromText(text: string, ticker: string, tidy: boolean): string | null {
  let s = text.trim();
  // A leading Pyth symbol ("Equity.US.NVDA/USD ", "Crypto.BTC/USD ").
  s = s.replace(/^\S*\/\S+\s+/, "");
  // The name ends where the quote currency or the feed details begin.
  s = s.split(/\s+\/\s+|,\s*/)[0]!.trim();
  if (!s || s.toUpperCase() === ticker.toUpperCase() || s.includes("/")) return null;
  return tidy ? tidyCase(s) : s;
}

export function assetName(m: { readonly label: string; readonly description: string; readonly legFeeds?: readonly ({ readonly description: string } | null)[] }): string | null {
  const ticker = m.label.split("/")[0] ?? "";
  return fromText(m.description, ticker, false) ?? (m.legFeeds?.[0] ? fromText(m.legFeeds[0].description, ticker, true) : null);
}
