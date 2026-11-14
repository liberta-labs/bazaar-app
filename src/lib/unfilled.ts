/**
 * Why an order that fills on arrival would be cut short ("Unfilled": a market order, or an
 * immediate-or-cancel limit). The pair walks the far side of the book from the best price and stops at
 * the order's price bound: the limit price, or for a market order the oracle price moved by the max
 * slippage. So a market order stops either at a level past that bound (the slippage limit stopped it,
 * though the book has more) or where the side runs out; telling them apart takes the far side's levels.
 *
 * The line names only what holds still: the user's own slippage and limit price, and the cause. How much
 * fills and how far the next order is come from a book read every few seconds that moves every block,
 * so in a fast market they'd jump on each read and be stale by the time the order lands.
 */
import { pct, price } from "./format";

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

/**
 * A short line on why the order would not fill in full, and what to do instead; `someFills` when part of
 * it would. What doesn't fill is cancelled.
 */
export function unfilledText(o: UnfilledOrder, someFills: boolean): string {
  const part = someFills ? "Only part of it fills" : "Nothing fills";
  if (o.kind === "limit") return `${part} at ${price(o.limitPrice)} or better.`;
  const generic = someFills ? "Only part of it can fill now." : "It can't fill now.";
  if (!o.far) return generic;
  const bound = slippageBound(o.oracle, o.slippageBp, o.isLong);
  const next = o.far.levels.find((l) => (o.isLong ? l.price > bound : l.price < bound))?.price;
  if (next === undefined) {
    // Nothing past the bound: the side ran out, if every level of it was read.
    if (!o.far.complete) return generic;
    return someFills ? "The book runs out before it all fills. Try a limit order." : `No ${o.isLong ? "sell" : "buy"} orders in the book. Try a limit order.`;
  }
  // Past the app's cap, more slippage can't reach the next order.
  const lead = `${part} within your ${bpText(o.slippageBp)} slippage.`;
  return slippageToReach(o.oracle, next, o.isLong) <= o.maxSlippageBp ? `${lead} Raise it or use a limit order.` : `${lead} Use a limit order.`;
}
