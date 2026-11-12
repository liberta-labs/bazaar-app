import { relay } from "@liberta-labs/bazaar-sdk";
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";
import { explain, rawMessage } from "../src/lib/errors";
import {
  FaucetRefusedError,
  type RelayConnection,
  RelayExpiredError,
  RelayFeeTooLowError,
  RelayRefusedError,
  RelayService,
  type RelayStep,
  RelayUnavailableError,
  runRelayed,
} from "../src/lib/relay";

const PAIR = "0x1111111111111111111111111111111111111111" as Address;
const USER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const HASH = ("0x" + "ab".repeat(32)) as Hex;
const OTHER_HASH = ("0x" + "cd".repeat(32)) as Hex;
const NOW = 1_794_236_400;

interface Reply {
  status: number;
  body?: unknown;
}

/** A fetch that answers each route from a queue and records what was asked. */
function fakeService(replies: { fee?: Reply[]; post?: Reply[]; info?: Reply[]; faucet?: Reply[] }, opts: { throwOnPost?: boolean } = {}) {
  const asked: { url: string; method: string; body?: string }[] = [];
  const queue = { fee: [...(replies.fee ?? [])], post: [...(replies.post ?? [])], info: [...(replies.info ?? [])], faucet: [...(replies.faucet ?? [])] };
  const f = (async (url: string, init?: RequestInit) => {
    asked.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
    const route = url.includes("/relay/fee") ? "fee" : url.endsWith("/relay/info") ? "info" : url.endsWith("/faucet") ? "faucet" : "post";
    if ((route === "post" || route === "faucet") && opts.throwOnPost) throw new TypeError("Failed to fetch");
    const r = queue[route].shift();
    if (!r) throw new Error(`no reply queued for ${route}`);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { fetch: f, asked };
}

const feeReply = (minFee = "0", validForSeconds = 30): Reply => ({
  status: 200,
  body: { chainId: 421614, action: "cancelOrders", relayer: "0x00000000000000000000000000000000000000aa", free: minFee === "0", minFee, minFeeUsd: "0", validForSeconds },
});

function signedRequest(over: Partial<relay.RelayedRequest> = {}): relay.RelayedRequest {
  return {
    action: "cancelOrders",
    orderIds: [42n],
    pair: PAIR,
    chainId: 421614,
    signer: USER,
    nonce: 3n,
    deadline: NOW + 10,
    relayerFee: 0n,
    signature: ("0x" + "11".repeat(65)) as Hex,
    permitData: "0x",
    ...over,
  } as relay.RelayedRequest;
}

/** A connection whose wallet signs instantly and whose receipts land. */
function fakeConnection(over: { request?: relay.RelayedRequest; receiptFails?: boolean } = {}) {
  const signed: { input: relay.RelayedInput; opts: relay.SignRelayedOptions }[] = [];
  const waited: Hex[] = [];
  const bz: RelayConnection = {
    chainId: 421614,
    relay: {
      async signRelayed(input, opts) {
        signed.push({ input, opts });
        return over.request ?? signedRequest({ relayerFee: opts.relayerFee ?? 0n });
      },
    },
    async waitForReceipt(hash) {
      waited.push(hash);
      if (over.receiptFails) throw new Error(`transaction ${hash} reverted`);
      return {};
    },
  };
  return { bz, signed, waited };
}

const base = (bz: RelayConnection, service: RelayService, steps: RelayStep[] = []) => ({
  bz,
  service,
  wallet: { request: async () => null },
  signer: USER,
  pair: PAIR,
  input: { action: "cancelOrders", orderIds: [42n] } as relay.RelayedInput,
  permit: true,
  onStep: (s: RelayStep) => steps.push(s),
  nowSeconds: () => NOW,
});

describe("runRelayed: every status the relayer answers", () => {
  it("202: quotes, signs at the quoted fee with a permit, posts the serialized request and waits for the receipt", async () => {
    const svc = fakeService({ fee: [feeReply("50000000000000000")], post: [{ status: 202, body: { hash: HASH, chainId: 421614 } }] });
    const { bz, signed, waited } = fakeConnection();
    const steps: RelayStep[] = [];
    const hash = await runRelayed(base(bz, new RelayService("http://svc", svc.fetch), steps));
    expect(hash).toBe(HASH);
    expect(signed[0]!.opts).toMatchObject({ signer: USER, pair: PAIR, relayerFee: 50_000_000_000_000_000n, permit: true });
    expect(svc.asked[0]!.url).toBe("http://svc/relay/fee?chainId=421614&action=cancelOrders");
    const post = svc.asked[1]!;
    expect(post).toMatchObject({ url: "http://svc/relay", method: "POST" });
    expect(JSON.parse(post.body!)).toMatchObject({ action: "cancelOrders", orderIds: ["42"], nonce: "3", relayerFee: "50000000000000000" });
    expect(waited).toEqual([HASH]);
    expect(steps.map((s) => s.step)).toEqual(["quote", "sign", "relaying", "confirming", "done"]);
  });

  it("leaves the permit out when asked to (withdrawCollateral takes none)", async () => {
    const svc = fakeService({ fee: [feeReply()], post: [{ status: 202, body: { hash: HASH, chainId: 421614 } }] });
    const { bz, signed } = fakeConnection();
    await runRelayed({ ...base(bz, new RelayService("http://svc", svc.fetch)), permit: false });
    expect("permit" in signed[0]!.opts).toBe(false);
  });

  it("409: follows the transaction the earlier request with this nonce sent", async () => {
    const svc = fakeService({ fee: [feeReply()], post: [{ status: 409, body: { error: "This nonce was already sent.", hash: OTHER_HASH } }] });
    const { bz, waited } = fakeConnection();
    expect(await runRelayed(base(bz, new RelayService("http://svc", svc.fetch)))).toBe(OTHER_HASH);
    expect(waited).toEqual([OTHER_HASH]);
  });

  it("402: reports the fee to sign instead, drops the cached quote, and a second run signs at it", async () => {
    const svc = fakeService({
      fee: [feeReply("20000000000000000"), feeReply("30000000000000000")],
      post: [
        { status: 402, body: { error: "The fee is short of the gas.", requiredFee: "30000000000000000", requiredFeeUsd: "0.03" } },
        { status: 202, body: { hash: HASH, chainId: 421614 } },
      ],
    });
    const service = new RelayService("http://svc", svc.fetch);
    const { bz, signed } = fakeConnection();
    const e = await runRelayed(base(bz, service)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RelayFeeTooLowError);
    expect((e as RelayFeeTooLowError).requiredFee).toBe(30_000_000_000_000_000n);
    expect((e as RelayFeeTooLowError).requiredFeeUsd).toBe("0.03");
    await runRelayed({ ...base(bz, service), fee: (e as RelayFeeTooLowError).requiredFee });
    expect(signed.map((s) => s.opts.relayerFee)).toEqual([20_000_000_000_000_000n, 30_000_000_000_000_000n]);
  });

  it("422 on the deadline: a signature that ran out of time asks for a new one", async () => {
    const svc = fakeService({ fee: [feeReply()], post: [{ status: 422, body: { error: "The request would revert.", problems: [{ field: "deadline", message: "expired 4 s ago" }] } }] });
    const { bz } = fakeConnection();
    await expect(runRelayed(base(bz, new RelayService("http://svc", svc.fetch)))).rejects.toBeInstanceOf(RelayExpiredError);
  });

  it("asks for a new signature when the relayer says it expires too soon", async () => {
    const svc = fakeService({ fee: [feeReply()], post: [{ status: 422, body: { error: "the signature expires too soon: sign again" } }] });
    const { bz } = fakeConnection();
    await expect(runRelayed(base(bz, new RelayService("http://svc", svc.fetch)))).rejects.toBeInstanceOf(RelayExpiredError);
  });

  it("does not post a request with under 2 seconds left, which the relayer would refuse", async () => {
    const svc = fakeService({ fee: [feeReply()] });
    const { bz } = fakeConnection({ request: signedRequest({ deadline: NOW + 1 }) });
    await expect(runRelayed(base(bz, new RelayService("http://svc", svc.fetch)))).rejects.toBeInstanceOf(RelayExpiredError);
    expect(svc.asked.some((a) => a.method === "POST")).toBe(false);
  });

  it("refuses to post a request whose deadline already passed while the wallet prompt was open", async () => {
    const svc = fakeService({ fee: [feeReply()] });
    const { bz } = fakeConnection({ request: signedRequest({ deadline: NOW - 1 }) });
    await expect(runRelayed(base(bz, new RelayService("http://svc", svc.fetch)))).rejects.toBeInstanceOf(RelayExpiredError);
    expect(svc.asked.filter((a) => a.method === "POST")).toEqual([]);
  });

  it("422 otherwise: shows the relayer's sentence and its problems", async () => {
    const problems = [{ field: "nonce", message: "nonce 3 is already used" }];
    const svc = fakeService({ fee: [feeReply()], post: [{ status: 422, body: { error: "The request would revert.", problems } }] });
    const { bz } = fakeConnection();
    const e = (await runRelayed(base(bz, new RelayService("http://svc", svc.fetch))).catch((x: unknown) => x)) as RelayRefusedError;
    expect(e).toBeInstanceOf(RelayRefusedError);
    expect(e.status).toBe(422);
    expect(e.message).toBe("The request would revert.");
    expect(e.problems).toEqual(problems);
  });

  it.each([400, 413, 429])("%i: shows the relayer's sentence", async (status) => {
    const svc = fakeService({ fee: [feeReply()], post: [{ status, body: { error: `refused with ${status}` } }] });
    const { bz } = fakeConnection();
    const e = (await runRelayed(base(bz, new RelayService("http://svc", svc.fetch))).catch((x: unknown) => x)) as RelayRefusedError;
    expect(e).toBeInstanceOf(RelayRefusedError);
    expect(e.status).toBe(status);
    expect(e.message).toBe(`refused with ${status}`);
    expect(e.problems).toEqual([]);
  });

  it.each([404, 502, 503])("%i: the relayer is unavailable (the page may offer the wallet instead)", async (status) => {
    const svc = fakeService({ fee: [feeReply()], post: [{ status, body: { error: "Relaying is paused on this chain." } }] });
    const { bz } = fakeConnection();
    const e = (await runRelayed(base(bz, new RelayService("http://svc", svc.fetch))).catch((x: unknown) => x)) as RelayUnavailableError;
    expect(e).toBeInstanceOf(RelayUnavailableError);
    expect(e.status).toBe(status);
    expect(e.message).toBe("Relaying is paused on this chain.");
  });

  it("a network failure on the post is an unavailable relayer", async () => {
    const svc = fakeService({ fee: [feeReply()] }, { throwOnPost: true });
    const { bz } = fakeConnection();
    await expect(runRelayed(base(bz, new RelayService("http://svc", svc.fetch)))).rejects.toBeInstanceOf(RelayUnavailableError);
  });

  it("a 202 without a hash is not taken as sent", async () => {
    const svc = fakeService({ fee: [feeReply()], post: [{ status: 202, body: {} }] });
    const { bz } = fakeConnection();
    await expect(runRelayed(base(bz, new RelayService("http://svc", svc.fetch)))).rejects.toBeInstanceOf(RelayUnavailableError);
  });

  it("a transaction that reverts fails the run after it was sent", async () => {
    const svc = fakeService({ fee: [feeReply()], post: [{ status: 202, body: { hash: HASH, chainId: 421614 } }] });
    const { bz } = fakeConnection({ receiptFails: true });
    const steps: RelayStep[] = [];
    await expect(runRelayed(base(bz, new RelayService("http://svc", svc.fetch), steps))).rejects.toThrow(/reverted/);
    expect(steps.at(-1)).toEqual({ step: "confirming", hash: HASH });
  });

  it("a declined signature stops before anything is posted", async () => {
    const svc = fakeService({ fee: [feeReply()] });
    const { bz } = fakeConnection();
    bz.relay.signRelayed = async () => {
      throw new Error("You declined the signature.");
    };
    await expect(runRelayed(base(bz, new RelayService("http://svc", svc.fetch)))).rejects.toThrow(/declined/);
    expect(svc.asked.filter((a) => a.method === "POST")).toEqual([]);
  });
});

describe("RelayService fee quotes", () => {
  it("reuses a quote until validForSeconds pass, then asks again", async () => {
    let now = 1_000_000;
    const svc = fakeService({ fee: [feeReply("1", 30), feeReply("2", 30)] });
    const service = new RelayService("http://svc", svc.fetch, () => now);
    expect((await service.fee(421614, "cancelOrders")).minFee).toBe(1n);
    now += 29_000;
    expect((await service.fee(421614, "cancelOrders")).minFee).toBe(1n);
    now += 2_000;
    expect((await service.fee(421614, "cancelOrders")).minFee).toBe(2n);
    expect(svc.asked.length).toBe(2);
  });

  it("an unreachable or failing fee route is an unavailable relayer", async () => {
    const svc = fakeService({ fee: [{ status: 503, body: { error: "The relayer wallet is low on ETH." } }] });
    await expect(new RelayService("http://svc", svc.fetch).fee(421614, "createOrder")).rejects.toBeInstanceOf(RelayUnavailableError);
  });

  it("tells whether the relayer serves a chain, reading /relay/info at most once a minute", async () => {
    const svc = fakeService({ info: [{ status: 200, body: { chains: [{ chainId: 421614, name: "testnet", relayer: "0x00", free: true }], actions: [] } }, { status: 503 }] });
    let now = 1_000_000;
    const service = new RelayService("http://svc", svc.fetch, () => now);
    expect(await service.available(421614)).toBe(true);
    expect(await service.available(1)).toBe(false);
    expect(svc.asked).toHaveLength(1);
    now += 60_000;
    expect(await service.available(421614)).toBe(false);
  });
});

describe("RelayService faucet", () => {
  const info = (faucets: unknown): Reply => ({ status: 200, body: { chains: [], actions: [], faucets } });

  it("reads the faucet the service offers on a chain, and none when it lists none or cannot be reached", async () => {
    const offered = new RelayService(
      "http://svc",
      fakeService({ info: [info([{ chainId: 421614, amountUsdc: "10000000000", amount: "10,000", perAddressPerDay: 2, perAddressSeconds: 86_400, available: true }])] }).fetch,
    );
    expect(await offered.faucet(421614)).toEqual({ chainId: 421614, amountUsdc: 10_000_000_000n, perAddressPerDay: 2, available: true });
    expect(await offered.faucet(42161)).toBeNull();
    const empty = new RelayService("http://svc", fakeService({ info: [info([{ chainId: 421614, amountUsdc: "10000000000", available: false }])] }).fetch);
    expect((await empty.faucet(421614))?.available).toBe(false);
    // An older service names no limit: one a day. A nonsense limit reads the same.
    expect((await empty.faucet(421614))?.perAddressPerDay).toBe(1);
    const odd = new RelayService("http://svc", fakeService({ info: [info([{ chainId: 421614, amountUsdc: "1", perAddressPerDay: 0.5 }])] }).fetch);
    expect((await odd.faucet(421614))?.perAddressPerDay).toBe(1);
    // An older service lists no faucets; a malformed amount is no offer.
    expect(await new RelayService("http://svc", fakeService({ info: [{ status: 200, body: { chains: [], actions: [] } }] }).fetch).faucet(421614)).toBeNull();
    expect(await new RelayService("http://svc", fakeService({ info: [info([{ chainId: 421614, amountUsdc: "lots" }])] }).fetch).faucet(421614)).toBeNull();
    expect(await new RelayService("http://svc", fakeService({ info: [{ status: 503 }] }).fetch).faucet(421614)).toBeNull();
  });

  it("posts the chain and address, and resolves with the hash on 202", async () => {
    const svc = fakeService({ faucet: [{ status: 202, body: { hash: HASH, chainId: 421614, amountUsdc: "10000000000" } }] });
    expect(await new RelayService("http://svc", svc.fetch).drip(421614, USER)).toBe(HASH);
    expect(svc.asked[0]).toMatchObject({ url: "http://svc/faucet", method: "POST" });
    expect(JSON.parse(svc.asked[0]!.body!)).toEqual({ chainId: 421614, address: USER });
  });

  it("turns each refusal into a sentence: a refusal for the user, unavailable when the service is down", async () => {
    const svc = fakeService({
      faucet: [
        { status: 429, body: { error: "this address already received test USDC 2 times today: try again in 3 h", retryAt: NOW } },
        { status: 409, body: { error: "this address already holds 12,500 test USDC, enough to try Bazaar" } },
        { status: 503, body: { error: "the faucet is empty right now: try again later" } },
        { status: 404, body: { error: "this service has no faucet on that chain" } },
        { status: 202, body: { hash: "0x12" } },
      ],
    });
    const service = new RelayService("http://svc", svc.fetch);
    const daily = await service.drip(421614, USER).catch((e: unknown) => e);
    expect(daily).toBeInstanceOf(FaucetRefusedError);
    expect([(daily as FaucetRefusedError).message, (daily as FaucetRefusedError).status, (daily as FaucetRefusedError).retryAt]).toEqual([
      "This address already received test USDC 2 times today: try again in 3 h.",
      429,
      NOW,
    ]);
    expect(explain(daily)).toBe("This address already received test USDC 2 times today: try again in 3 h.");
    const rich = await service.drip(421614, USER).catch((e: unknown) => e);
    expect([rich instanceof FaucetRefusedError, (rich as Error).message]).toEqual([true, "This address already holds 12,500 test USDC, enough to try Bazaar."]);
    for (const status of [503, 404, 202]) {
      const e = await service.drip(421614, USER).catch((x: unknown) => x);
      expect(e, String(status)).toBeInstanceOf(RelayUnavailableError);
    }
    const down = new RelayService("http://svc", fakeService({}, { throwOnPost: true }).fetch);
    await expect(down.drip(421614, USER)).rejects.toThrow("The faucet cannot be reached right now.");
  });
});

describe("explain: the wallet's own words", () => {
  it("shows the wallet's message, first line, URLs redacted, when nothing recognises the error", () => {
    const e = Object.assign(new Error("Request failed"), { shortMessage: "Transaction creation failed.", details: "execution reverted: paused\nmore lines" });
    expect(explain(e)).toBe("Your wallet reported: execution reverted: paused");
    const nested = { message: "x", cause: { code: -32000, message: "header not found at https://rpc.example/key-SECRET" } };
    const text = explain(nested);
    expect(text).toMatch(/^Your wallet reported: header not found at /);
    expect(text).not.toContain("SECRET");
  });

  it("keeps the SDK's sentences for what it recognises, and its generic one when there are no words at all", () => {
    expect(explain({ code: 4001, message: "User rejected the request." })).toMatch(/cancel|reject/i);
    expect(explain({})).toBe("Something went wrong. Please try again.");
    expect(rawMessage({ message: "An internal error occurred." })).toBeNull();
    expect(rawMessage(Object.assign(new Error("x".repeat(400))))!.length).toBeLessThanOrEqual(200);
  });
});
