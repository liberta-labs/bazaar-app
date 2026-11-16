/**
 * The gasless path: quote the relayer's fee, have the wallet sign the request (and a USDC permit for
 * what it pulls), post it at once, and follow the transaction. A signed request lives at most 10
 * seconds, so the signature is asked for only after the fee is known, and posted the moment it
 * comes back.
 */
import { formatUnits18, relay, type signing } from "@liberta-labs/bazaar-sdk";
import type { Address, Hex } from "viem";

export type RelayAction = signing.SignedFields["action"];

export interface FeeQuote {
  readonly chainId: number;
  readonly action: RelayAction;
  readonly relayer: Address | null;
  readonly free: boolean;
  /** 18 decimals, as signRelayed takes it. */
  readonly minFee: bigint;
  readonly validForSeconds: number;
  /** Date.now() when it was fetched. */
  readonly fetchedAt: number;
}

export interface RelayProblem {
  readonly field: string;
  readonly message: string;
}

/** The relayer could not be reached, or is down or paused (502, 503, a network failure). */
export class RelayUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/** The gas cost more than the signed fee (402): sign again with `requiredFee`. */
export class RelayFeeTooLowError extends Error {
  constructor(
    readonly requiredFee: bigint,
    readonly requiredFeeUsd: string,
  ) {
    super(`The network fee rose to $${requiredFeeUsd}. Sign again to pay it.`);
  }
}

/** The signature ran out of time before it could be sent: sign again. */
export class RelayExpiredError extends Error {
  constructor(message = "The signature ran out of time before Bazaar's relayer could send it. Sign again and approve as soon as your wallet opens: a gasless signature is valid for about 30 seconds.") {
    super(message);
  }
}

/** The relayer refused the request: `message` is its sentence, `problems` the checks that failed. */
export class RelayRefusedError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly problems: readonly RelayProblem[],
  ) {
    super(message);
  }
}

/** The service's testnet faucet on a chain, as /relay/info lists it. */
export interface FaucetOffer {
  readonly chainId: number;
  /** USDC units (6 decimals) one drip sends. */
  readonly amountUsdc: bigint;
  /** Drips one address may receive in any 24 hours (rolling, not per calendar day); 1 when the service does not say. */
  readonly perAddressPerDay: number;
  /** False while its stock is empty. */
  readonly available: boolean;
}

/** The service refused a faucet request: `message` is its sentence; `retryAt` (Unix seconds) when it says. */
export class FaucetRefusedError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAt: number | null,
  ) {
    super(message);
  }
}

export type RelayAnswer =
  | { readonly kind: "sent"; readonly hash: Hex }
  | { readonly kind: "duplicate"; readonly hash: Hex };

const isHash = (x: unknown): x is Hex => typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x);

function problemsOf(body: Record<string, unknown>): RelayProblem[] {
  if (!Array.isArray(body.problems)) return [];
  return body.problems.flatMap((p) =>
    p && typeof p === "object" && typeof (p as RelayProblem).message === "string"
      ? [{ field: String((p as RelayProblem).field ?? ""), message: (p as RelayProblem).message }]
      : [],
  );
}

/** A 422 that says the signature ran out of time, which a fresh signature fixes. */
function isExpiry(error: string, problems: readonly RelayProblem[]): boolean {
  return problems.some((p) => p.field === "deadline") || /deadline|ran out of time|expired|expires too soon/i.test(error);
}

/** The relayer refuses a request with less than this many seconds left on its signature. */
export const MIN_SECONDS_LEFT = 2;

/** The service's relay routes. */
export class RelayService {
  private readonly quotes = new Map<string, FeeQuote>();

  constructor(
    readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
    private readonly now: () => number = Date.now,
  ) {}

  private async getJson(path: string): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { cache: "no-store" });
    } catch {
      throw new RelayUnavailableError("The relayer cannot be reached right now.", null);
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg = typeof body.error === "string" ? body.error : `The relayer answered ${res.status}.`;
      if (res.status >= 500 || res.status === 404) throw new RelayUnavailableError(msg, res.status);
      throw new RelayRefusedError(msg, res.status, problemsOf(body));
    }
    return body;
  }

  /** The least fee to sign now, reused until its `validForSeconds` pass. */
  async fee(chainId: number, action: RelayAction): Promise<FeeQuote> {
    const key = `${chainId}:${action}`;
    const cached = this.quotes.get(key);
    if (cached && this.now() - cached.fetchedAt < cached.validForSeconds * 1000) return cached;
    const b = await this.getJson(`/relay/fee?chainId=${chainId}&action=${encodeURIComponent(action)}`);
    if (typeof b.minFee !== "string" || !/^\d+$/.test(b.minFee)) throw new RelayUnavailableError("The relayer sent an unreadable fee quote.", null);
    const quote: FeeQuote = {
      chainId,
      action,
      relayer: typeof b.relayer === "string" ? (b.relayer as Address) : null,
      free: b.free === true,
      minFee: BigInt(b.minFee),
      validForSeconds: typeof b.validForSeconds === "number" && b.validForSeconds > 0 ? b.validForSeconds : 30,
      fetchedAt: this.now(),
    };
    this.quotes.set(key, quote);
    return quote;
  }

  /** Forget cached quotes (after a 402 the fee has moved). */
  clearQuotes(): void {
    this.quotes.clear();
  }

  private info: { at: number; body: Promise<Record<string, unknown>> } | null = null;

  /** /relay/info, reused for a minute; a failed read is not reused. */
  private relayInfo(): Promise<Record<string, unknown>> {
    if (this.info && this.now() - this.info.at < 60_000) return this.info.body;
    const body = this.getJson("/relay/info");
    const entry = { at: this.now(), body };
    this.info = entry;
    body.catch(() => {
      if (this.info === entry) this.info = null;
    });
    return body;
  }

  /** Whether the relayer serves this chain. */
  async available(chainId: number): Promise<boolean> {
    try {
      const b = await this.relayInfo();
      return Array.isArray(b.chains) && b.chains.some((c) => c && typeof c === "object" && (c as { chainId?: unknown }).chainId === chainId);
    } catch {
      return false;
    }
  }

  /** The service's testnet faucet on this chain, or null when it has none or cannot be reached. */
  async faucet(chainId: number): Promise<FaucetOffer | null> {
    try {
      const b = await this.relayInfo();
      if (!Array.isArray(b.faucets)) return null;
      const f = b.faucets.find((x) => x && typeof x === "object" && (x as { chainId?: unknown }).chainId === chainId) as
        | { amountUsdc?: unknown; perAddressPerDay?: unknown; available?: unknown }
        | undefined;
      if (!f || typeof f.amountUsdc !== "string" || !/^\d+$/.test(f.amountUsdc)) return null;
      const n = f.perAddressPerDay;
      const perAddressPerDay = typeof n === "number" && Number.isSafeInteger(n) && n >= 1 ? n : 1;
      return { chainId, amountUsdc: BigInt(f.amountUsdc), perAddressPerDay, available: f.available !== false };
    } catch {
      return null;
    }
  }

  /**
   * Ask the service's faucet to send test USDC to `address`: the service sends it from its own wallet,
   * so the user signs nothing and pays no gas. Resolves with the transaction's hash.
   */
  async drip(chainId: number, address: Address): Promise<Hex> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/faucet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId, address }),
        cache: "no-store",
      });
    } catch {
      throw new RelayUnavailableError("The faucet cannot be reached right now.", null);
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const error = typeof body.error === "string" ? body.error : `The faucet answered ${res.status}.`;
    if (res.status === 202) {
      if (!isHash(body.hash)) throw new RelayUnavailableError("The faucet answered without a transaction hash.", 202);
      return body.hash;
    }
    // The service's sentences are lower case: start them as a sentence.
    const sentence = `${error.charAt(0).toUpperCase()}${error.slice(1)}${/[.!?]$/.test(error) ? "" : "."}`;
    if (res.status >= 500 || res.status === 404) {
      this.info = null;
      throw new RelayUnavailableError(sentence, res.status);
    }
    throw new FaucetRefusedError(sentence, res.status, typeof body.retryAt === "number" ? body.retryAt : null);
  }

  /** Post a signed request and turn every status the service documents into an answer or an error. */
  async post(req: relay.RelayedRequest): Promise<RelayAnswer> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/relay`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: relay.serializeRelayed(req),
        cache: "no-store",
      });
    } catch {
      throw new RelayUnavailableError("The relayer cannot be reached right now.", null);
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const error = typeof body.error === "string" ? body.error : `The relayer answered ${res.status}.`;
    const problems = problemsOf(body);
    switch (res.status) {
      case 202:
        if (!isHash(body.hash)) throw new RelayUnavailableError("The relayer answered without a transaction hash.", 202);
        return { kind: "sent", hash: body.hash };
      case 409:
        if (isHash(body.hash)) return { kind: "duplicate", hash: body.hash };
        throw new RelayRefusedError(error, 409, problems);
      case 402: {
        const required = typeof body.requiredFee === "string" && /^\d+$/.test(body.requiredFee) ? BigInt(body.requiredFee) : null;
        if (required === null) throw new RelayRefusedError(error, 402, problems);
        const usd = typeof body.requiredFeeUsd === "string" || typeof body.requiredFeeUsd === "number" ? String(body.requiredFeeUsd) : formatUnits18(required, 2);
        this.clearQuotes();
        throw new RelayFeeTooLowError(required, usd);
      }
      case 422:
        if (isExpiry(error, problems)) throw new RelayExpiredError();
        throw new RelayRefusedError(error, 422, problems);
      case 502:
      case 503:
      case 404:
        throw new RelayUnavailableError(error, res.status);
      default:
        throw new RelayRefusedError(error, res.status, problems);
    }
  }
}

/** The steps a relayed action shows the user. */
export type RelayStep =
  | { readonly step: "quote" }
  | { readonly step: "sign"; readonly fee: bigint }
  | { readonly step: "relaying" }
  | { readonly step: "confirming"; readonly hash: Hex }
  | { readonly step: "done"; readonly hash: Hex };

/** What runRelayed needs of a Bazaar connection (a subset of `Bazaar`, so tests can fake it). */
export interface RelayConnection {
  readonly chainId: number;
  readonly relay: { signRelayed(input: relay.RelayedInput, opts: relay.SignRelayedOptions): Promise<relay.RelayedRequest> };
  waitForReceipt(hash: Hex): Promise<unknown>;
}

export interface RunRelayedArgs {
  readonly bz: RelayConnection;
  readonly service: RelayService;
  readonly wallet: relay.SignRelayedOptions["wallet"];
  readonly signer: Address;
  readonly pair: Address;
  readonly input: relay.RelayedInput;
  /** Sign a USDC permit for what the call pulls (every action but withdrawCollateral). */
  readonly permit: boolean;
  /** Sign at this fee instead of the quote (after a 402). */
  readonly fee?: bigint;
  readonly onStep?: (s: RelayStep) => void;
  /** Unix seconds now, for the local expiry check. */
  readonly nowSeconds?: () => number;
}

/** The action a relayed input signs. */
export const actionOf = (input: relay.RelayedInput): RelayAction => input.action;

/**
 * Quote, sign, post and wait for one relayed action. Throws RelayFeeTooLowError (sign again with its
 * fee), RelayExpiredError (sign again), RelayUnavailableError (the relayer is down: offer the wallet
 * where the action allows it), RelayRefusedError, or whatever signing or the receipt throws.
 */
export async function runRelayed(a: RunRelayedArgs): Promise<Hex> {
  const now = a.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  a.onStep?.({ step: "quote" });
  const fee = a.fee ?? (await a.service.fee(a.bz.chainId, actionOf(a.input))).minFee;
  a.onStep?.({ step: "sign", fee });
  const req = await a.bz.relay.signRelayed(a.input, {
    wallet: a.wallet,
    signer: a.signer,
    pair: a.pair,
    relayerFee: fee,
    ...(a.permit ? { permit: true } : {}),
  });
  // A request with under MIN_SECONDS_LEFT left (the time went by while the wallet prompt was open)
  // would only be refused by the relayer: ask for a fresh signature without posting it.
  if (req.deadline - now() < MIN_SECONDS_LEFT) throw new RelayExpiredError();
  a.onStep?.({ step: "relaying" });
  const answer = await a.service.post(req);
  a.onStep?.({ step: "confirming", hash: answer.hash });
  await a.bz.waitForReceipt(answer.hash);
  a.onStep?.({ step: "done", hash: answer.hash });
  return answer.hash;
}
