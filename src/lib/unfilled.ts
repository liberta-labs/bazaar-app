/**
 * Why an order that fills on arrival would be cut short ("Unfilled": a market order, or an
 * immediate-or-cancel limit). The pair walks the far side of the book from the best price and stops at
 * the order's price bound: the limit price, or for a market order the oracle price moved by the max
 * slippage. So a market order stops either at a level past that bound (the slippage limit stopped it,
 * though the book has more) or where the side runs out; telling them apart takes the far side's levels.
 */
import { pct, price, sizeText } from "./format";

const BP = 10_000n;

/** The worst price a market order may fill at: the oracle price moved by the max slippage (the SDK's walk bound). */
export function slippageBound(oracle: bigint, slippageBp: bigint, isLong: boolean): bigint {
  const adj = (oracle * slippageBp) / BP;
  return isLong ? oracle + adj : oracle - adj;
}

/** The max slippage, in basis points rounded up, that lets a market order reach price `p`. */
export function slippageToReach(oracle: bigint, p: bigint, isLong: boolean): bigint {
  const gap = isLong ? p - oracle : oracle - p;
  if (gap <= 0n || oracle <= 0n) return 0n;
  return (gap * BP + oracle - 1n) / oracle;
}

const bpText = (bp: bigint) => pct(Number(bp) / 10_000);

/** The far side of the book, best level first, as markets.getBookDepth returns it. */
export interface FarSide {
  readonly levels: readonly { readonly price: bigint }[];
  /** Every level the side has is listed. */
  readonly complete: boolean;
}

export type UnfilledOrder =
  | {
      readonly kind: "market";
      readonly isLong: boolean;
      /** The price the preview judged at (the oracle price). */
      readonly oracle: bigint;
      readonly slippageBp: bigint;
      /** The most slippage the ticket allows. */
      readonly maxSlippageBp: bigint;
      /** The far side, or null while it is read (or when it can't be). */
      readonly far: FarSide | null;
    }
  | { readonly kind: "limit"; readonly isLong: boolean; readonly limitPrice: bigint };

/** One sentence (or two) on why the order would not fill in full, and what to do instead. */
export function unfilledText(o: UnfilledOrder, filled: bigint, base: string): string {
  const some = filled > 0n;
  const others = o.isLong ? "sell orders" : "buy orders";
  if (o.kind === "limit") {
    return some
      ? `Only ${sizeText(filled)} ${base} fills at ${price(o.limitPrice)} or better now; immediate-or-cancel cancels the rest.`
      : `No ${others} at ${price(o.limitPrice)} or better now, so immediate-or-cancel would cancel it.`;
  }
  const generic = some ? "Only part of it can fill now; the rest would be cancelled." : "It can't fill now, so it would be cancelled.";
  if (!o.far) return generic;
  const bound = slippageBound(o.oracle, o.slippageBp, o.isLong);
  const next = o.far.levels.find((l) => (o.isLong ? l.price > bound : l.price < bound))?.price;
  if (next === undefined) {
    // Nothing past the bound: the side ran out, if every level of it was read.
    if (!o.far.complete) return generic;
    return some
      ? `The book runs out after ${sizeText(filled)} ${base}; the rest would be cancelled. Place a limit order for the rest.`
      : `There are no ${others} in the book right now, so it would be cancelled. Place a limit order to wait for one.`;
  }
  const need = slippageToReach(o.oracle, next, o.isLong);
  const where = `${bpText(need)} ${o.isLong ? "above" : "below"} the oracle price (${price(o.oracle)})`;
  const lead = some
    ? `Only ${sizeText(filled)} ${base} fills within your ${bpText(o.slippageBp)} max slippage; the next ${o.isLong ? "sell" : "buy"} order is at ${price(next)}, ${where}. The rest would be cancelled.`
    : `No ${others} within your ${bpText(o.slippageBp)} max slippage: the ${o.isLong ? "cheapest" : "highest"} is ${price(next)}, ${where}.`;
  const advice =
    need <= o.maxSlippageBp
      ? `Set max slippage to ${bpText(need)} to reach it, or place a limit order at that price.`
      : `That's past the ${bpText(o.maxSlippageBp)} a market order can allow, so place a limit order at that price, or wait for a better offer.`;
  return `${lead} ${advice}`;
}
