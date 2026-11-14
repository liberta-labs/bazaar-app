/** How an order reads in the tables: its trigger as a condition, its time in force, its value. */
import { history } from "@liberta-labs/bazaar-sdk";
import { price } from "./format";

/** Orders that wait for a trigger. A market order stores a price too, but only as its reference. */
const TRIGGERED = new Set(["StopLimit", "TakeProfit", "StopLoss"]);
/** Orders that rest in the book, for which a time in force means something. */
const RESTING = new Set(["Limit", "StopLimit"]);

/**
 * "Price ≥ $72,000" for a trigger order, following the pair's own test (triggerReached): a take-profit
 * fires when the price moves its way (a sell's up, a buy's down), a stop-limit or stop-loss when it moves
 * against it. Null for an order without a trigger.
 */
export function triggerCondition(typeName: string, isLong: boolean, triggerPrice: bigint): string | null {
  if (!TRIGGERED.has(typeName) || triggerPrice <= 0n) return null;
  const rises = typeName === "TakeProfit" ? !isLong : isLong;
  return `Price ${rises ? "≥" : "≤"} ${price(triggerPrice)}`;
}

/** "GTC", "IOC" or "FOK", with post-only marked; null for an order that never rests. */
export function tifText(typeName: string, tif: number | string, postOnly: boolean): string | null {
  if (!RESTING.has(typeName)) return null;
  const name = typeof tif === "number" ? (history.TIME_IN_FORCE[tif] ?? String(tif)) : tif;
  return postOnly ? `${name} · post-only` : name;
}

/**
 * The size a take-profit or stop-loss carries when it closes the whole position, whatever that is when it
 * fires: uint128's largest value (the SDK's live orders read it as closesWholePosition). It stays on the
 * order in history until it fires, when the pair caps it at the position.
 */
const WHOLE_POSITION = (1n << 128n) - 1n;

/** A size that is the whole-position marker, not an amount. */
export function closesWholePosition(size: bigint): boolean {
  return size >= WHOLE_POSITION;
}

/** Size at its limit price, else at its trigger; null for a market order, or one that closes the whole position. */
export function orderValue(typeName: string, size: bigint, limitPrice: bigint, triggerPrice: bigint): bigint | null {
  if (closesWholePosition(size)) return null;
  const p = limitPrice > 0n ? limitPrice : TRIGGERED.has(typeName) ? triggerPrice : 0n;
  return p > 0n && size > 0n ? (size * p) / 10n ** 18n : null;
}
