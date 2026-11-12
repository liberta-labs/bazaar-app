/**
 * Display formatting. Every amount is an 18-decimal bigint and is formatted with the SDK's own
 * formatters (exact decimal arithmetic); numbers appear only for ratios and percentages.
 */
import { allowance, format, formatUnits18, parseUnits18, toNumber18 } from "@liberta-labs/bazaar-sdk";

export const usd = (x: bigint) => format.formatUsd(x);
export const price = (x: bigint) => format.formatPrice(x);
export const amount = (x: bigint, dp = 6) => format.formatAmount(x, dp);

/**
 * A position or order size (18 decimals) to at least 4 significant figures, so a small size never
 * reads as "0" and a book level never looks smaller than it is: 0.001372 BTC, not 0.0013; 0.000072,
 * not 0. At least 4 decimals, at most 10.
 */
export function sizeText(x: bigint): string {
  const abs = x < 0n ? -x : x;
  // Zeros between the decimal point and the first significant digit: 0.001372 has 2.
  let zeros = 0;
  for (let unit = 10n ** 17n; abs > 0n && abs < unit && zeros < 6; unit /= 10n) zeros++;
  return format.formatAmount(x, zeros + 4);
}
export const usdcUnits = (x: bigint) => allowance.formatUsdcUnits(x);

/** "+$12.30" / "-$4.00" for profit and loss. */
export function signedUsd(x: bigint): string {
  return x > 0n ? `+${usd(x)}` : usd(x);
}

/** 0.0123 -> "1.23%". */
export function pct(fraction: number | null | undefined, dp = 2): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "–";
  return `${(fraction * 100).toFixed(dp)}%`;
}

export const signedPct = (f: number | null | undefined, dp = 2) => (f !== null && f !== undefined && f > 0 ? `+${pct(f, dp)}` : pct(f, dp));

/** An 18-decimal rate (1e18 = 100%) as a percentage. */
export function rate18(x: bigint, dp = 4): string {
  return `${(toNumber18(x) * 100).toFixed(dp)}%`;
}

export const bp = (x: bigint) => format.formatBp(x);
export const duration = (s: number) => format.formatDuration(Math.max(0, Math.round(s)));

export function dateTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function shortDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "in 3 h" / "5 min ago". */
export function relative(unix: number, now: number = Date.now() / 1000): string {
  const d = Math.round(unix - now);
  if (Math.abs(d) < 5) return "now";
  return d > 0 ? `in ${duration(d)}` : `${duration(-d)} ago`;
}

export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const leverage = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : `${x.toFixed(x < 10 ? 2 : 1)}×`);

/** Parse what a user typed; null for anything that is not a plain decimal. */
export function parseInput(text: string): bigint | null {
  const t = text.trim().replace(/,/g, "");
  if (!t) return null;
  try {
    return parseUnits18(t);
  } catch {
    return null;
  }
}

/** A bigint back into an input field's text. */
export const toInput = (x: bigint, dp = 6) => formatUnits18(x, dp);

/** Integer division rounding up, for amounts that must cover something. */
export const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
