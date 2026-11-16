/**
 * Display formatting. Every amount is an 18-decimal bigint and is formatted with the SDK's own
 * formatters (exact decimal arithmetic); numbers appear only for ratios and percentages.
 */
import { allowance, format, formatUnits18, parseUnits18, toNumber18 } from "@liberta-labs/bazaar-sdk";

export const usd = (x: bigint) => format.formatUsd(x);
export const amount = (x: bigint, dp = 6) => format.formatAmount(x, dp);

/** Zeros between the decimal point and the first significant digit of an 18-decimal amount: 0.001372 has 2; 1 or more, and 0, have none. */
export function zerosAfterPoint(x: bigint): number {
  const abs = x < 0n ? -x : x;
  let zeros = 0;
  for (let unit = 10n ** 17n; abs > 0n && abs < unit; unit /= 10n) zeros++;
  return zeros;
}

/**
 * A price, as the SDK formats it, except under $0.0001, where its 8 decimals would leave a meme coin as
 * $0.00000007 and a day's change as $0: there it keeps 4 significant figures, $0.00000007123.
 */
export function price(x: bigint): string {
  const abs = x < 0n ? -x : x;
  if (abs === 0n || abs >= 10n ** 14n) return format.formatPrice(x);
  return `${x < 0n ? "-" : ""}$${format.formatAmount(abs, zerosAfterPoint(abs) + 4)}`;
}

/**
 * A price chart's axis decimals: 2 from $1,000, 4 from $1, and under $1 at least 6, more for a smaller
 * price so the axis keeps 5 significant figures (MOG at $0.00000007 needs 12, or every label reads 0.000000).
 */
export function chartPrecision(p: bigint | null): number {
  if (!p) return 2;
  const whole = p / 10n ** 18n;
  return whole >= 1000n ? 2 : whole >= 1n ? 4 : Math.max(6, zerosAfterPoint(p) + 5);
}

/**
 * A suggested price for a form field: its hint, or what the mark button fills in. From $1, 2 decimals;
 * under $1, at least 6 and enough for 5 significant figures, so DOGE's $0.05783 doesn't become 0.05 and
 * MOG's $0.0000000753 doesn't become 0. (A book level or an order's own price goes in exactly.)
 */
export function priceInput(p: bigint): string {
  const abs = p < 0n ? -p : p;
  return toInput(p, abs >= 10n ** 18n ? 2 : Math.max(6, zerosAfterPoint(abs) + 5));
}

/**
 * A position or order size (18 decimals) to at least 4 significant figures, so a small size never
 * reads as "0" and a book level never looks smaller than it is: 0.001372 BTC, not 0.0013; 0.000072,
 * not 0. At least 4 decimals, at most 10.
 */
export function sizeText(x: bigint): string {
  return format.formatAmount(x, Math.min(zerosAfterPoint(x), 6) + 4);
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

/** An 18-decimal rate with its sign, as exchanges show funding: "+0.0017%", "-0.0002%", and no sign on one that rounds to zero. */
export function signedRate18(x: bigint, dp = 4): string {
  const s = rate18(x, dp);
  if (!/[1-9]/.test(s)) return rate18(0n, dp);
  return x > 0n ? `+${s}` : s;
}

/** The colour class for a rate shown by {@link signedRate18}: none for one that shows as zero. */
export const rateTone = (x: bigint, dp = 4): "up" | "down" | "" => {
  const s = signedRate18(x, dp);
  return s.startsWith("+") ? "up" : s.startsWith("-") ? "down" : "";
};

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

/** A market's leverage for a badge, without trailing zeros: "25×", "12.5×", "2.5×". */
export const leverageShort = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : `${Number(x.toFixed(x < 10 ? 2 : 1))}×`);

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
