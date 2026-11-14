/**
 * A max gas fee with room to spare, suggested to the wallet with every transaction it sends.
 *
 * The app asks the wallet to send (eth_sendTransaction) and used to leave the gas price to it. Some
 * wallets cap the fee at exactly the network's current gas price. Arbitrum's price moves a little from
 * block to block, and Arbitrum turns a transaction away at once when the block's price is above its
 * cap ("max fee per gas less than block base fee") rather than letting it wait.
 *
 * The cap is only a ceiling: Arbitrum charges each transaction the block's base fee and ignores tips,
 * so a higher cap costs nothing. The app suggests twice the current price and no tip (Arbitrum's own
 * eth_maxPriorityFeePerGas is 0). Most wallets use a site's suggestion; some always pick their own.
 */
import { toHex } from "viem";
import type { Eip1193 } from "./wallet";

/** The suggested max fee, as a multiple of the network's current gas price. */
export const FEE_HEADROOM = 2n;

export function suggestedFees(gasPrice: bigint): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
  return { maxFeePerGas: gasPrice * FEE_HEADROOM, maxPriorityFeePerGas: 0n };
}

/**
 * The wallet, with a fee suggested on each eth_sendTransaction that names none: the current price from
 * `gasPrice` times FEE_HEADROOM. When the price can't be read, the transaction goes as it was and the
 * wallet picks the fee. Every other request passes through untouched.
 */
export function withSuggestedFees(wallet: Eip1193, gasPrice: () => Promise<bigint>): Eip1193 {
  return {
    request: async (args) => {
      const params = args.params;
      const tx: unknown = args.method === "eth_sendTransaction" && Array.isArray(params) ? params[0] : undefined;
      if (!tx || typeof tx !== "object" || "maxFeePerGas" in tx || "gasPrice" in tx) return wallet.request(args);
      const price = await gasPrice().catch(() => null);
      if (!price) return wallet.request(args);
      const fees = suggestedFees(price);
      const suggested = { ...tx, maxFeePerGas: toHex(fees.maxFeePerGas), maxPriorityFeePerGas: toHex(fees.maxPriorityFeePerGas) };
      return wallet.request({ ...args, params: [suggested, ...(params as readonly unknown[]).slice(1)] });
    },
  };
}
