import { BAZAAR_SCALE, CallError, DecodedError } from "@liberta-labs/bazaar-sdk";
import { encodeErrorResult } from "viem";
import { describe, expect, it } from "vitest";
import { explain, usdcErrorSentence } from "../src/lib/errors";
import { listingShortfall } from "../src/lib/listing";

const WALLET = "0xB1549E9BD6Da8d0edB0BFC2b2F1d68a76CD0ad06";
const FACTORY = "0x9f077B7D49EE7B451ae0858e391dC6960F144612";
const ABI = [
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      { name: "sender", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientAllowance",
    inputs: [
      { name: "spender", type: "address" },
      { name: "allowance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
] as const;
// The revert a 4,000 USDC listing hit from a wallet holding 1,860.76 USDC.
const SHORT = encodeErrorResult({ abi: ABI, errorName: "ERC20InsufficientBalance", args: [WALLET, 1_860_760_000n, 4_000_000_000n] });

describe("usdcErrorSentence", () => {
  it("says what the wallet holds and what the transfer needed", () => {
    expect(SHORT.slice(0, 10)).toBe("0xe450d38c");
    expect(usdcErrorSentence(SHORT)).toBe("Your wallet holds 1,860.76 USDC, and this needs 4,000 USDC. Get more USDC, then try again.");
  });

  it("says what the approval covers when it is too small", () => {
    const data = encodeErrorResult({ abi: ABI, errorName: "ERC20InsufficientAllowance", args: [FACTORY, 1_000_000_000n, 4_000_000_000n] });
    expect(data.slice(0, 10)).toBe("0xfb8f41b2");
    expect(usdcErrorSentence(data)).toBe("Your USDC approval covers 1,000 USDC, and this needs 4,000 USDC. Try again to approve the full amount.");
  });

  it("leaves every other revert alone", () => {
    expect(usdcErrorSentence("0x19abf40e")).toBeNull();
    expect(usdcErrorSentence("0x")).toBeNull();
    expect(usdcErrorSentence("0xe450d38c")).toBeNull();
  });
});

describe("explain", () => {
  it("words the failed simulation the SDK could only name by selector", () => {
    const decoded = new DecodedError("Unknown(0xe450d38c)", {}, "An error this package's ABIs do not declare.", SHORT);
    expect(explain(new CallError(decoded.hint, decoded))).toBe("Your wallet holds 1,860.76 USDC, and this needs 4,000 USDC. Get more USDC, then try again.");
  });
});

describe("listingShortfall", () => {
  const total = 4_000n * BAZAAR_SCALE;

  it("stops a listing the wallet can't pay for, with both amounts", () => {
    expect(listingShortfall(1_860_760_000n, total)).toBe("This wallet holds 1,860.76 USDC, and the listing pulls 4,000 USDC. Get more USDC first.");
  });

  it("lets it through when the wallet holds enough", () => {
    expect(listingShortfall(4_000_000_000n, total)).toBeNull();
    expect(listingShortfall(1_026_900_000_000n, total)).toBeNull();
  });

  it("says nothing while the balance or the amount is unknown", () => {
    expect(listingShortfall(undefined, total)).toBeNull();
    expect(listingShortfall(null, total)).toBeNull();
    expect(listingShortfall(0n, null)).toBeNull();
  });
});
