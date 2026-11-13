/**
 * What an order does to the position it meets, named on the order ticket's button. The side alone says
 * too little: "Short BTC" on an order that only closes a long reads as a new bet against the price.
 */
import { orders } from "@liberta-labs/bazaar-sdk";

/** Opens a position or adds to one; trades part of it away; ends flat; ends on the other side. */
export type OrderEffect = "open" | "reduce" | "close" | "flip";

/**
 * The order's effect, assuming it fills in full. `size` is in the base asset, `orders.CLOSE_POSITION`
 * for the whole position, or null before one is entered; `held` is the position on this market, null
 * when there is none. Worked out from the request alone, so the button does not wait on the preview.
 */
export function orderEffect(isLong: boolean, size: bigint | null, held: { readonly isLong: boolean; readonly size: bigint } | null): OrderEffect {
  if (!held || held.size === 0n || held.isLong === isLong) return "open";
  if (size === orders.CLOSE_POSITION || size === held.size) return "close";
  // Before an amount is entered, an order against the position reads as trading some of it away.
  if (size === null || size < held.size) return "reduce";
  return "flip";
}

/** The button's words: "Long BTC", "Sell BTC", "Close long", "Flip to short". */
export function effectLabel(effect: OrderEffect, isLong: boolean, base: string): string {
  switch (effect) {
    case "open":
      return `${isLong ? "Long" : "Short"} ${base}`;
    case "reduce":
      return `${isLong ? "Buy" : "Sell"} ${base}`;
    case "close":
      return `Close ${isLong ? "short" : "long"}`;
    case "flip":
      return `Flip to ${isLong ? "long" : "short"}`;
  }
}
