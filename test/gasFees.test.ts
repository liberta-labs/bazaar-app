import { describe, expect, it } from "vitest";
import { FEE_HEADROOM, suggestedFees, withSuggestedFees } from "../src/lib/gasFees";
import type { Eip1193 } from "../src/lib/wallet";

/** A wallet that records each request it gets. */
function recorder() {
  const seen: { method: string; params?: readonly unknown[] | object }[] = [];
  const wallet: Eip1193 = {
    request: async (args) => {
      seen.push(args);
      return "0xhash";
    },
  };
  return { wallet, seen };
}

const TX = { from: "0x285dc9998bef6f02ac32924cdf0e0b06eb802459", to: "0x9f077b7d49ee7b451ae0858e391dc6960f144612", data: "0x1234", value: "0x0" };
// Arbitrum Sepolia's minimum: 0.02 gwei.
const FLOOR = 20_000_000n;

describe("suggestedFees", () => {
  it("doubles the current price and tips nothing", () => {
    expect(FEE_HEADROOM).toBe(2n);
    expect(suggestedFees(FLOOR)).toEqual({ maxFeePerGas: 40_000_000n, maxPriorityFeePerGas: 0n });
  });

  it("leaves room for the price that turned a transaction away at exactly the floor", () => {
    // The rejected send capped the fee at 20,000,000 while the block's base fee was 20,034,000.
    expect(suggestedFees(FLOOR).maxFeePerGas > 20_034_000n).toBe(true);
  });
});

describe("withSuggestedFees", () => {
  it("adds a max fee of twice the current price, and no tip, to a transaction the wallet sends", async () => {
    const { wallet, seen } = recorder();
    const hash = await withSuggestedFees(wallet, async () => FLOOR).request({ method: "eth_sendTransaction", params: [TX] });
    expect(hash).toBe("0xhash");
    expect(seen).toEqual([{ method: "eth_sendTransaction", params: [{ ...TX, maxFeePerGas: "0x2625a00", maxPriorityFeePerGas: "0x0" }] }]);
  });

  it("keeps a fee the transaction already names", async () => {
    for (const fee of [{ maxFeePerGas: "0x1" }, { gasPrice: "0x1" }]) {
      const { wallet, seen } = recorder();
      let read = false;
      const tx = { ...TX, ...fee };
      await withSuggestedFees(wallet, async () => ((read = true), FLOOR)).request({ method: "eth_sendTransaction", params: [tx] });
      expect(seen[0]!.params).toEqual([tx]);
      expect(read).toBe(false);
    }
  });

  it("sends the transaction as it was when the price can't be read, so the wallet picks the fee", async () => {
    for (const gasPrice of [async () => Promise.reject(new Error("rpc down")), async () => 0n]) {
      const { wallet, seen } = recorder();
      await withSuggestedFees(wallet, gasPrice).request({ method: "eth_sendTransaction", params: [TX] });
      expect(seen[0]!.params).toEqual([TX]);
    }
  });

  it("passes every other request through untouched, without reading the price", async () => {
    const { wallet, seen } = recorder();
    let read = false;
    const fees = withSuggestedFees(wallet, async () => ((read = true), FLOOR));
    const args = { method: "eth_signTypedData_v4", params: [TX.from, "{}"] };
    await fees.request(args);
    await fees.request({ method: "eth_chainId" });
    expect(seen).toEqual([args, { method: "eth_chainId" }]);
    expect(read).toBe(false);
  });
});
