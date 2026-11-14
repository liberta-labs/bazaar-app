/**
 * Open interest as the pair counts it (RiskParamsLib.openInterestSize): one side, not both. Every long
 * is matched by a short, so the open positions are counted once, as exchanges count open interest.
 * Each side includes what the vault took over from liquidations (it stands where the trader stood), and
 * the larger side is taken, as the pair takes it. Its insurance target, coverage and fee rate are all
 * measured against this figure.
 */
import { BAZAAR_SCALE } from "@liberta-labs/bazaar-sdk";

/** A market snapshot's open interest, by side (base asset, 18 decimals). */
type Sides = { readonly long: bigint; readonly short: bigint; readonly longInventory: bigint; readonly shortInventory: bigint };

/** The size of the open interest, in the base asset (18 decimals). */
export function openInterestSize(oi: Sides): bigint {
  const long = oi.long + oi.longInventory;
  const short = oi.short + oi.shortInventory;
  return long > short ? long : short;
}

/** Its value in USDC (18 decimals), at the market's stored price. */
export function openInterestNotional(snap: { readonly openInterest: Sides; readonly price: { readonly spot: bigint } }): bigint {
  return (openInterestSize(snap.openInterest) * snap.price.spot) / BAZAAR_SCALE;
}
