/**
 * One sentence for any error a step can throw. errorMessage(e) from the SDK covers contract reverts,
 * input errors and wallet failures; the cases it words generically (signing, connection, subgraph,
 * a bare reverted receipt) carry a good sentence of their own, used here first.
 */
import { CallError, ConnectError, DecodedError, InputError, UnitError, errorMessage, history, redactUrls, signing, uma, walletErrorMessage } from "@liberta-labs/bazaar-sdk";
import { type Hex, decodeErrorResult } from "viem";
import { FaucetRefusedError, RelayExpiredError, RelayFeeTooLowError, RelayRefusedError, RelayUnavailableError } from "./relay";

/** A step sent from the wallet, and the wallet holds no ETH to pay its gas. */
export class NoGasError extends Error {
  constructor(network: string) {
    super(`Your wallet has no ${network} ETH to pay the network fee. Get some free from a faucet below, then try again.`);
  }
}

/** The SDK's sentence for an error it does not recognise. */
const GENERIC = "Something went wrong. Please try again.";

/**
 * The wallet's or node's own words for an error nothing above recognised: the first readable message
 * down its cause chain (viem's shortMessage and details, an EIP-1193 error's message), first line only,
 * URLs redacted, at most 200 characters. Rendered as text, never HTML. Null when there is none.
 */
export function rawMessage(e: unknown): string | null {
  let cur: unknown = e;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8 && cur && typeof cur === "object" && !seen.has(cur); depth++) {
    seen.add(cur);
    const o = cur as { shortMessage?: unknown; details?: unknown; message?: unknown; cause?: unknown; error?: unknown; data?: { message?: unknown } };
    for (const t of [o.details, o.shortMessage, o.data?.message, o.message]) {
      if (typeof t !== "string") continue;
      const line = redactUrls(t.split("\n")[0] ?? "").replace(/^(Details|Error|RPC Error):\s*/i, "").trim();
      if (line.length >= 4 && !/^(an? )?(unknown|internal) (rpc )?error( has)?( occurred)?\.?$/i.test(line)) return line.length > 200 ? `${line.slice(0, 197)}…` : line;
    }
    cur = o.cause ?? o.error;
  }
  if (typeof e === "string" && e.trim().length >= 4) return redactUrls(e.trim()).slice(0, 200);
  return null;
}

/** Errors the SDK's ABIs do not declare, by the name decodeError gives them. */
const EXTRA_MESSAGES: Record<string, string> = {
  // Pyth's StalePrice(): the price aged past the pair's 3 s window before the call landed.
  "Unknown(0x19abf40e)": "The price moved on before your transaction landed. Try again.",
};

/**
 * OpenZeppelin's ERC-20 errors, which the test USDC raises when a transfer finds too little balance or
 * approval. The SDK's ABIs don't declare them, so it names them only by selector.
 */
const ERC20_ERRORS = [
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

/** A USDC transfer that found too little balance or approval, in words. Null for any other revert. */
export function usdcErrorSentence(data: Hex): string | null {
  let decoded;
  try {
    decoded = decodeErrorResult({ abi: ERC20_ERRORS, data });
  } catch {
    return null;
  }
  const [, have, need] = decoded.args;
  return decoded.errorName === "ERC20InsufficientBalance"
    ? `Your wallet holds ${uma.usdcText(have)}, and this needs ${uma.usdcText(need)}. Get more USDC, then try again.`
    : `Your USDC approval covers ${uma.usdcText(have)}, and this needs ${uma.usdcText(need)}. Try again to approve the full amount.`;
}

/** The device's clock is off: nothing was signed. */
export const isClockSkew = (e: unknown): e is signing.ClockSkewError => e instanceof signing.ClockSkewError;

/** The user said no in their wallet: a choice, not a failure. */
export function isRejection(e: unknown): boolean {
  const w = walletErrorMessage(e);
  if (w && /rejected/i.test(w)) return true;
  return e instanceof signing.SigningError && /declined/i.test(e.message);
}

/** A missing price source on a step only a keeper with Pyth's archive can complete. */
export const isKeeperOnly = (e: unknown) => e instanceof ConnectError && /price|pyth/i.test(e.message);

export function explain(e: unknown): string {
  if (e instanceof RelayFeeTooLowError || e instanceof RelayExpiredError || e instanceof RelayUnavailableError) return e.message;
  if (e instanceof FaucetRefusedError || e instanceof NoGasError) return e.message;
  if (e instanceof RelayRefusedError) {
    const extra = e.problems.map((p) => p.message).filter((m) => m && m !== e.message);
    return extra.length ? `${e.message} (${extra.join("; ")})` : e.message;
  }
  if (isClockSkew(e)) return "Your device's clock is more than 2 minutes off. Set it to update automatically, then try again.";
  if (e instanceof UnitError) return "Enter amounts as plain numbers, like 12.5.";
  const decoded = e instanceof DecodedError ? e : e instanceof CallError ? e.decoded : null;
  if (decoded && EXTRA_MESSAGES[decoded.name]) return EXTRA_MESSAGES[decoded.name]!;
  const usdc = decoded ? usdcErrorSentence(decoded.data) : null;
  if (usdc) return usdc;
  if (e instanceof InputError) return inputSentence(e);
  if (e instanceof signing.SigningError) return walletErrorMessage(e) ?? e.message;
  if (e instanceof ConnectError) return walletErrorMessage(e) ?? e.message;
  if (e instanceof history.SubgraphError || (e instanceof Error && e.name === "SubgraphError")) return "History is unavailable right now. Try again in a moment.";
  if (e instanceof uma.BondQuoteError) return e.message;
  if (e instanceof CallError && !e.decoded && /reverted$/.test(e.message)) {
    return "The transaction was reverted on chain. Nothing changed; check the market and try again.";
  }
  const sdk = errorMessage(e);
  if (sdk !== GENERIC) return sdk;
  // Nothing recognised it: the wallet's own words beat a generic sentence.
  const raw = rawMessage(e);
  return raw ? `Your wallet reported: ${raw}` : sdk;
}

/** An InputError's sentence without its "field: " prefix. */
export function inputSentence(e: InputError): string {
  return e.message.startsWith(`${e.field}: `) ? e.message.slice(e.field.length + 2) : e.message;
}
