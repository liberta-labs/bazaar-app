/**
 * Checks for a new market listing against Pyth Pro's symbols registry, before any bond is posted:
 * which feed the ID names, whether it trades around the clock, a description UMA's verifiers can
 * match against the feed, and whether the one typed matches it. A listing whose description, feed or
 * 24/7 flag does not match what Pyth publishes is likely to be disputed, and the bond lost.
 */
import { ProClient, PYTH_PRO, type ProSymbol, feedLabel, listings } from "@liberta-labs/bazaar-sdk";

/** A client for the registry alone: no price endpoint, so it needs no Pyth key. */
export function registryClient(): ProClient {
  return new ProClient({ symbolsUrl: PYTH_PRO.symbolsUrl, restUrl: PYTH_PRO.symbolsUrl, streamUrls: [] });
}

/**
 * Whether a registry schedule trades around the clock. A schedule reads
 * "<time zone>;<seven daily sessions, Monday first>;<holiday overrides>". Around the clock is every day
 * "O" (open all day) and no holiday that closes or shortens a day.
 */
export function scheduleIs247(schedule: string): boolean | null {
  const parts = schedule.split(";");
  if (parts.length < 2) return null;
  const days = parts[1]!.split(",").map((d) => d.trim());
  if (days.length !== 7) return null;
  const holidays = (parts[2] ?? "").trim();
  return days.every((d) => d === "O") && holidays === "";
}

/** Whether a feed is one Pyth still publishes normally. */
export function feedIsLive(s: ProSymbol): boolean {
  return s.state.toLowerCase() === "stable" && !/deprecated/i.test(s.description);
}

const ALLOWED = /[^A-Za-z0-9 .,&/-]/g;

/** "BITCOIN / US DOLLAR" -> "Bitcoin / US Dollar": title case, with country codes and `keep` (the ticker) in capitals. */
function titleCase(text: string, keep: readonly string[] = []): string {
  const caps = new Set(keep.map((k) => k.toUpperCase()));
  return text
    .toLowerCase()
    .replace(/\b([a-z])([a-z]*)\b/g, (_, a: string, b: string) => a.toUpperCase() + b)
    .replace(/\b(Us|Usd|Uk|Eu|Etf|Adr|Ag|Sa|Nv|Se)\b/g, (w) => w.toUpperCase())
    .replace(/\b[A-Za-z0-9]+\b/g, (w) => (caps.has(w.toUpperCase()) ? w.toUpperCase() : w));
}

/** Text the factory accepts: only letters, digits, space and . , & / -, at most 200 bytes. */
export function sanitizeDescription(text: string): string {
  return text.replace(ALLOWED, " ").replace(/\s+/g, " ").trim().slice(0, listings.MAX_DESCRIPTION_LENGTH).trim();
}

/** A description for a raw feed, from its registry entry: "Bitcoin / US Dollar, BTC/USD, Pyth Pro feed 1". */
export function suggestDescription(s: ProSymbol): string {
  const label = feedLabelOf(s.symbol);
  const name = titleCase(s.description.replace(/^DEPRECATED FEED\s*-\s*/i, ""), [tickerOf(s)]);
  const full = sanitizeDescription(`${name}, ${label}, Pyth Pro feed ${s.id}`);
  if (!listings.descriptionProblem(full)) return full;
  const short = sanitizeDescription(`${label}, Pyth Pro feed ${s.id}`);
  return listings.descriptionProblem(short) ? `Pyth Pro feed ${s.id}` : short;
}

/** A description for a composite: the base asset priced in USD through an FX leg. */
export function suggestCompositeDescription(base: ProSymbol, quote: ProSymbol, invertQuote: boolean): string {
  const asset = tickerOf(base);
  return sanitizeDescription(
    `${titleCase(base.description, [asset])}, ${asset}/USD via ${feedLabelOf(quote.symbol)}${invertQuote ? " inverted" : ""}, Pyth Pro feeds ${base.id} and ${quote.id}`,
  );
}

/** "Equity.US.AAPL/USD" -> "AAPL". */
const tickerOf = (s: ProSymbol): string => feedLabelOf(s.symbol).split("/")[0] ?? feedLabelOf(s.symbol);

/** "Crypto.BTC/USD" -> "BTC/USD". */
export const feedLabelOf = (symbol: string): string => feedLabel(symbol);

const COMMON = new Set(["US", "USD", "DOLLAR", "INC", "CORP", "CO", "LTD", "PLC", "THE", "AND", "OF", "CLASS", "SHARES", "COMMON", "STOCK", "ORDINARY", "FEED", "PYTH", "PRO", "VIA", "ON", "SPOT"]);

const words = (t: string) =>
  t
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((w) => w.length >= 2 && !COMMON.has(w));

/**
 * Why a typed description may not match the feed, or null. It should name the asset: its ticker, or a
 * distinctive word of Pyth's own description of it.
 */
export function descriptionMismatch(description: string, feeds: readonly ProSymbol[]): string | null {
  if (!description.trim() || !feeds.length) return null;
  const typed = new Set(words(description));
  const base = feeds[0]!;
  const ticker = (feedLabelOf(base.symbol).split("/")[0] ?? "").toUpperCase();
  const expected = new Set([ticker, ...words(base.name), ...words(base.description)]);
  for (const w of typed) if (expected.has(w)) return null;
  return `The description doesn't name the asset this feed prices (${feedLabelOf(base.symbol)}, "${titleCase(base.description, [ticker])}"). UMA's verifiers compare the two, and a mismatch is grounds to dispute the listing.`;
}

/** Why the 24/7 flag disagrees with the feed's schedule, or null. A composite never trades around the clock. */
export function continuousMismatch(flag: boolean, feeds: readonly ProSymbol[], composite: boolean): string | null {
  if (!feeds.length) return null;
  if (composite) return flag ? "A composite feed is priced through an FX leg, which doesn't trade around the clock: untick 24/7." : null;
  const is247 = scheduleIs247(feeds[0]!.schedule);
  if (is247 === null) return null;
  if (flag && !is247) return "Pyth's schedule for this feed has trading hours, but the market is marked 24/7. A 24/7 market whose feed stops at night is judged stale; untick 24/7.";
  if (!flag && is247) return "Pyth publishes this feed around the clock, but the market is marked as having trading hours. Tick 24/7.";
  return null;
}

/** Registry entries matching a search ("AAPL", "gold", "Crypto.ETH"), live feeds first. */
export function searchSymbols(all: readonly ProSymbol[], query: string, limit = 8): ProSymbol[] {
  const q = query.trim().toUpperCase();
  if (q.length < 2) return [];
  const score = (s: ProSymbol): number => {
    const label = feedLabelOf(s.symbol).toUpperCase();
    const ticker = label.split("/")[0] ?? "";
    let n = 0;
    if (ticker === q || label === q) n += 100;
    else if (ticker.startsWith(q)) n += 50;
    else if (s.symbol.toUpperCase().includes(q) || s.name.toUpperCase().includes(q)) n += 20;
    else if (s.description.toUpperCase().includes(q)) n += 10;
    else return 0;
    if (feedIsLive(s)) n += 5;
    if (label.endsWith("/USD")) n += 2;
    return n;
  };
  return all
    .map((s) => [s, score(s)] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].id - b[0].id)
    .slice(0, limit)
    .map(([s]) => s);
}
