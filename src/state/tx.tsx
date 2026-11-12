/**
 * Every write the app makes runs here, in one modal: a confirmation that restates what will happen,
 * then each step with its progress (sign, relaying, confirming), an Arbiscan link, and the way out of
 * every failure: sign again when a signature expired, sign at the new fee after a 402, or send from
 * the wallet when the relayer is down and the action allows it.
 *
 * A user's relayed requests on one market land strictly in nonce order, so only one runs per market
 * at a time: `busy(pair)` is true until it lands or fails, and the page disables that market's actions.
 */
import type { Bazaar, PreparedCall, relay } from "@liberta-labs/bazaar-sdk";
import { formatUnits18, CallError } from "@liberta-labs/bazaar-sdk";
import { type ReactNode, createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { ACTIVE } from "../config/networks";
import { NoGasError, explain, isRejection } from "../lib/errors";
import { usd } from "../lib/format";
import { type RelayAction, RelayExpiredError, RelayFeeTooLowError, RelayUnavailableError, runRelayed } from "../lib/relay";
import { NeedsWalletError, useRead, useRelayService, useWallet } from "./connection";
import { TxModal } from "../components/TxModal";

/** One step of a job: a gasless request through the relayer, or calls sent from the wallet. */
export type TxPart =
  | {
      readonly kind: "relayed";
      readonly label: string;
      readonly pair: Address;
      /** Built at signing time, so an order's expiry block is fresh. */
      readonly input: () => Promise<relay.RelayedInput> | relay.RelayedInput;
      /** Sign a USDC permit for what it pulls; false only for withdrawCollateral. */
      readonly permit: boolean;
      /** The same action sent from the wallet, offered when the relayer is down. */
      readonly fallback?: (bz: Bazaar, user: Address) => Promise<PreparedCall[]>;
    }
  | {
      readonly kind: "wallet";
      readonly label: string;
      /** The calls to send in order: approvals first, then the call itself. */
      readonly build: (bz: Bazaar, user: Address) => Promise<PreparedCall[]>;
    }
  | {
      /** Sent by Bazaar's service from its own wallet (the testnet faucet): nothing to sign, no gas. */
      readonly kind: "service";
      readonly label: string;
      /** Ask the service; resolves with the transaction's hash. */
      readonly send: (user: Address) => Promise<Hex>;
      /** What the step says while the service sends. */
      readonly waiting: string;
      /** The same from the wallet, offered when the service is down. */
      readonly fallback?: (bz: Bazaar, user: Address) => Promise<PreparedCall[]>;
    };

export interface TxJob {
  readonly title: string;
  /** What will happen, restated for the confirmation ("Buy 0.5 ETH at $2,950"). */
  readonly summary: readonly ReactNode[];
  readonly parts: readonly TxPart[];
  /** The market whose relayed requests this job sends, locked until it ends. */
  readonly pair?: Address;
  /** Skip the confirmation (the form already showed one). */
  readonly confirmed?: boolean;
  readonly onDone?: () => void;
  /**
   * Once every part landed, close this window and call this instead of showing the done screen, with
   * the last transaction's hash: to open what comes next (the wallet guide after the faucet, say).
   */
  readonly next?: (hash: Hex | undefined) => void;
}

export type StepState = "pending" | "active" | "done" | "failed";

export interface StepView {
  readonly label: string;
  readonly state: StepState;
  readonly detail?: string;
  readonly hash?: Hex;
}

export interface TxView {
  readonly job: TxJob;
  readonly phase: "confirm" | "running" | "done" | "failed";
  readonly steps: readonly StepView[];
  /** Fee lines for the confirmation, per relayed part. */
  readonly fees: readonly string[];
  readonly error: string | null;
  /** What the user can do about the failure. */
  readonly recovery: null | { readonly kind: "signAgain" | "newFee" | "useWallet"; readonly label: string; readonly note?: string };
  /** True when a wallet part needs ETH for gas. */
  readonly needsGas: boolean;
  /** The wallet's ETH, read when a part needs gas: null until read (or when it cannot be). */
  readonly ethWei: bigint | null;
  readonly hint: string | null;
}

interface TxApi {
  /** Start a job; resolves true when every part landed. */
  run(job: TxJob): Promise<boolean>;
  busy(pair: Address | undefined): boolean;
}

const TxCtx = createContext<TxApi | null>(null);

const ACTION_OF = (input: relay.RelayedInput): RelayAction => input.action;

export function TxProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const { readBz } = useRead();
  const service = useRelayService();
  const [view, setView] = useState<TxView | null>(null);
  const [busyPairs, setBusyPairs] = useState<ReadonlySet<string>>(new Set());
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  // Resume point: which part failed, and how to retry it.
  const resume = useRef<{ partIndex: number; fee?: bigint; viaWallet?: boolean } | null>(null);

  const lock = useCallback((pair: Address | undefined, on: boolean) => {
    if (!pair) return;
    setBusyPairs((s) => {
      const n = new Set(s);
      if (on) n.add(pair.toLowerCase());
      else n.delete(pair.toLowerCase());
      return n;
    });
  }, []);

  const patchStep = (i: number, patch: Partial<StepView>) =>
    setView((v) => (v ? { ...v, steps: v.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : v));

  const finish = useCallback(
    (job: TxJob, ok: boolean) => {
      lock(job.pair, false);
      resolver.current?.(ok);
      resolver.current = null;
      if (ok) job.onDone?.();
    },
    [lock],
  );

  const execute = useCallback(
    async (job: TxJob, from: number, opts: { fee?: bigint; viaWallet?: boolean } = {}) => {
      setView((v) => (v ? { ...v, phase: "running", error: null, recovery: null } : v));
      let w: Awaited<ReturnType<typeof wallet.requireWallet>>;
      try {
        w = await wallet.requireWallet();
      } catch (e) {
        if (e instanceof NeedsWalletError) {
          // The connect window is open: close this one and let the user act again once connected.
          setView(null);
        } else {
          const msg = explain(e);
          setView((v) => (v ? { ...v, phase: "failed", error: msg, recovery: null } : v));
        }
        finish(job, false);
        return;
      }
      let lastHash: Hex | undefined;
      for (let i = from; i < job.parts.length; i++) {
        const part = job.parts[i]!;
        const useWalletPath = part.kind === "wallet" || (i === from && opts.viaWallet);
        try {
          if (part.kind === "service" && !useWalletPath) {
            patchStep(i, { state: "active", detail: part.waiting });
            const hash = await part.send(w.address);
            patchStep(i, { detail: "Confirming on Arbitrum…", hash });
            await w.walletBz.waitForReceipt(hash);
            lastHash = hash;
            patchStep(i, { state: "done", detail: "Confirmed", hash });
          } else if (part.kind === "relayed" && !useWalletPath) {
            const input = await part.input();
            await runRelayed({
              // Reads (chain time, nonce) over the public RPC, which reports a fresh latest block; a
              // wallet's provider can report one seconds old, eating into the 10-second window.
              bz: readBz ?? w.walletBz,
              service,
              wallet: w.provider as never,
              signer: w.address,
              pair: part.pair,
              input,
              permit: part.permit,
              fee: i === from ? opts.fee : undefined,
              onStep: (s) => {
                if (s.step === "quote") patchStep(i, { state: "active", detail: "Getting the network fee…" });
                if (s.step === "sign")
                  patchStep(i, {
                    detail:
                      "Approve in your wallet. If it asks twice, the first is a USDC permit (no time limit); approve the second within 10 seconds.",
                  });
                if (s.step === "relaying") patchStep(i, { detail: "Relaying: Bazaar's relayer is sending it for you…" });
                if (s.step === "confirming") patchStep(i, { detail: "Confirming on Arbitrum…", hash: s.hash });
                if (s.step === "done") {
                  lastHash = s.hash;
                  patchStep(i, { state: "done", detail: "Confirmed", hash: s.hash });
                }
              },
            });
          } else {
            const build = part.kind === "wallet" ? part.build : part.fallback!;
            patchStep(i, { state: "active", detail: "Preparing…" });
            // A wallet with no ETH cannot pay the gas: say so plainly, before the wallet's own error.
            const eth = await w.walletBz.ctx.chain.balance(w.address).catch(() => null);
            if (eth !== null) setView((v) => (v ? { ...v, ethWei: eth } : v));
            if (eth === 0n) throw new NoGasError(ACTIVE.name);
            const calls = await build(w.walletBz, w.address);
            let last: Hex | undefined;
            for (const call of calls) {
              patchStep(i, { detail: `Checking: ${call.summary}` });
              const sim = await w.walletBz.simulate(call);
              if (!sim.ok) throw new CallError(sim.error?.message ?? "This transaction would fail.", sim.error ?? null);
              patchStep(i, { detail: `Confirm in your wallet: ${call.summary}` });
              const hash = await w.walletBz.send(w.provider as never, call);
              last = hash;
              patchStep(i, { detail: "Confirming on Arbitrum…", hash });
              await w.walletBz.waitForReceipt(hash);
            }
            if (last) lastHash = last;
            patchStep(i, { state: "done", detail: "Confirmed", hash: last });
          }
        } catch (e) {
          console.error(part.label, e);
          let recovery: TxView["recovery"] = null;
          let msg = explain(e);
          if (e instanceof RelayExpiredError) {
            recovery = { kind: "signAgain", label: "Sign again", note: "On a phone, switch back to this page as soon as you approve." };
            resume.current = { partIndex: i };
          } else if (e instanceof RelayFeeTooLowError) {
            recovery = { kind: "newFee", label: `Sign again at $${e.requiredFeeUsd}` };
            resume.current = { partIndex: i, fee: e.requiredFee };
          } else if (e instanceof RelayUnavailableError && part.kind !== "wallet" && part.fallback && !useWalletPath) {
            msg = `${e.message} You can send this from your wallet instead; it needs a little ${ACTIVE.name} ETH for gas.`;
            recovery = { kind: "useWallet", label: part.kind === "service" ? "Claim from my wallet" : "Send from my wallet" };
            resume.current = { partIndex: i, viaWallet: true };
            setView((v) => (v ? { ...v, needsGas: true } : v));
          } else if (isRejection(e)) {
            msg = "You cancelled in your wallet. Nothing was sent.";
          }
          patchStep(i, { state: "failed", detail: msg });
          setView((v) => (v ? { ...v, phase: "failed", error: msg, recovery } : v));
          if (!recovery) finish(job, false);
          return;
        }
      }
      if (job.next) {
        setView(null);
        finish(job, true);
        job.next(lastHash);
        return;
      }
      setView((v) => (v ? { ...v, phase: "done" } : v));
      finish(job, true);
    },
    [wallet, service, finish, readBz],
  );

  const run = useCallback(
    (job: TxJob) =>
      new Promise<boolean>((resolve) => {
        if (job.pair && busyPairs.has(job.pair.toLowerCase())) {
          resolve(false);
          return;
        }
        resolver.current = resolve;
        resume.current = null;
        lock(job.pair, true);
        const needsGas = job.parts.some((p) => p.kind === "wallet");
        if (needsGas && wallet.address && readBz) {
          // Read the wallet's ETH for the confirmation, so a wallet with none hears it before signing.
          void readBz.ctx.chain
            .balance(wallet.address)
            .then((eth) => setView((cur) => (cur && cur.job === job ? { ...cur, ethWei: eth } : cur)))
            .catch(() => undefined);
        }
        const v: TxView = {
          job,
          phase: job.confirmed ? "running" : "confirm",
          steps: job.parts.map((p) => ({ label: p.label, state: "pending" as StepState })),
          fees: [],
          error: null,
          recovery: null,
          needsGas,
          ethWei: null,
          hint: null,
        };
        setView(v);
        // Quote the relayer's fee for the confirmation.
        void (async () => {
          const lines: string[] = [];
          for (const p of job.parts) {
            if (p.kind !== "relayed") continue;
            try {
              const input = await p.input();
              const q = await service.fee(ACTIVE.chainId, ACTION_OF(input));
              lines.push(q.minFee === 0n ? `${p.label}: no network fee (Bazaar's relayer pays the gas)` : `${p.label}: network fee ${usd(q.minFee)}`);
            } catch (e) {
              lines.push(`${p.label}: ${e instanceof RelayUnavailableError ? "the relayer is unavailable right now" : explain(e)}`);
            }
          }
          setView((cur) => (cur && cur.job === job ? { ...cur, fees: lines } : cur));
        })();
        if (job.confirmed) void execute(job, 0);
      }),
    [busyPairs, lock, service, execute, wallet.address, readBz],
  );

  const confirm = useCallback(() => {
    if (view) void execute(view.job, 0);
  }, [view, execute]);

  const recover = useCallback(() => {
    if (!view || !resume.current) return;
    const r = resume.current;
    setView((v) => (v ? { ...v, steps: v.steps.map((s, j) => (j === r.partIndex ? { ...s, state: "pending", detail: undefined } : s)) } : v));
    void execute(view.job, r.partIndex, { fee: r.fee, viaWallet: r.viaWallet });
  }, [view, execute]);

  const close = useCallback(() => {
    if (view && (view.phase === "confirm" || view.phase === "failed")) finish(view.job, false);
    setView(null);
  }, [view, finish]);

  const api = useMemo<TxApi>(() => ({ run, busy: (p) => !!p && busyPairs.has(p.toLowerCase()) }), [run, busyPairs]);

  return (
    <TxCtx.Provider value={api}>
      {children}
      {view && <TxModal view={view} onConfirm={confirm} onRecover={recover} onClose={close} />}
    </TxCtx.Provider>
  );
}

export function useTx(): TxApi {
  const v = useContext(TxCtx);
  if (!v) throw new Error("useTx outside its provider");
  return v;
}

/** A fee in dollars for a summary line. */
export const feeText = (fee: bigint) => (fee === 0n ? "no network fee" : `fee $${formatUnits18(fee, 2)}`);
