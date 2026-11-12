/**
 * The app's connections to Bazaar:
 * - `readBz`, read-only over the public RPC URL, open from the first render so markets, charts, the
 *   book and governance show before any wallet connects;
 * - `walletBz`, over the connected wallet's EIP-1193 provider, once it is on the app's chain. Signing
 *   and sending go through it (the SDK's signRelayed and send take the same provider as `wallet`).
 * Plus the price board, the wallet's state, and the smart-wallet check.
 */
import { Bazaar, type markets } from "@liberta-labs/bazaar-sdk";
import { useAppKit, useAppKitAccount, useAppKitNetwork, useAppKitProvider, useDisconnect } from "@reown/appkit/react";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getAddress } from "viem";
import type { Address, Hex } from "viem";
import { RPC_URL, SERVICE_URL } from "../config/env";
import { ACTIVE } from "../config/networks";
import { type Board, BoardPrices, fetchBoard } from "../lib/board";
import { explain } from "../lib/errors";
import { RelayService } from "../lib/relay";
import { type AccountKind, type Eip1193, SwitchChainError, canSignRelayed, classifyCode, switchToChain } from "../lib/wallet";

// ---------------------------------------------------------------------------------------------
// Read connection and markets
// ---------------------------------------------------------------------------------------------

interface ReadState {
  readonly readBz: Bazaar | null;
  readonly markets: readonly markets.MarketInfo[];
  readonly error: string | null;
  readonly refreshMarkets: () => Promise<void>;
}

const ReadCtx = createContext<ReadState | null>(null);

function ReadProvider({ children }: { children: ReactNode }) {
  const [readBz, setReadBz] = useState<Bazaar | null>(null);
  const [list, setList] = useState<readonly markets.MarketInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const bz = await Bazaar.connect({ transport: RPC_URL, chainId: ACTIVE.chainId });
        if (dead) return;
        setReadBz(bz);
        const ms = await bz.markets.listMarkets();
        if (!dead) {
          setList(ms);
          setError(null);
        }
      } catch (e) {
        console.error("connect", e);
        if (!dead) {
          setError(`Can't reach ${ACTIVE.name} right now. ${explain(e)}`);
          setTimeout(() => !dead && setAttempt((a) => a + 1), 10_000);
        }
      }
    })();
    return () => {
      dead = true;
    };
  }, [attempt]);

  const refreshMarkets = useCallback(async () => {
    if (!readBz) return;
    setList(await readBz.markets.listMarkets({ refresh: true }));
  }, [readBz]);

  const value = useMemo(() => ({ readBz, markets: list, error, refreshMarkets }), [readBz, list, error, refreshMarkets]);
  return <ReadCtx.Provider value={value}>{children}</ReadCtx.Provider>;
}

export function useRead(): ReadState {
  const v = useContext(ReadCtx);
  if (!v) throw new Error("useRead outside its provider");
  return v;
}

/** The market with this address, or undefined while the list loads. */
export function useMarketInfo(address: string | undefined): markets.MarketInfo | undefined {
  const { markets: list } = useRead();
  return useMemo(() => list.find((m) => address && m.address.toLowerCase() === address.toLowerCase()), [list, address]);
}

// ---------------------------------------------------------------------------------------------
// The price board
// ---------------------------------------------------------------------------------------------

interface BoardState {
  readonly board: Board | null;
  /** The board as the SDK's LivePriceView; null until the first board arrives. */
  readonly prices: BoardPrices | null;
  readonly error: string | null;
  /** Date.now() of the last good fetch. */
  readonly fetchedAt: number | null;
}

const BoardCtx = createContext<BoardState | null>(null);
export const BOARD_INTERVAL_MS = 10_000;

function BoardProvider({ children }: { children: ReactNode }) {
  const { markets: list } = useRead();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setTimeout>;
    const ctl = new AbortController();
    const tick = async () => {
      try {
        const b = await fetchBoard(SERVICE_URL, fetch, ctl.signal);
        if (dead) return;
        setBoard(b);
        setError(null);
        setFetchedAt(Date.now());
      } catch (e) {
        if (!dead) setError(e instanceof Error && e.name !== "AbortError" ? "Live prices are unavailable right now; showing the last stored prices." : null);
      }
      if (!dead) timer = setTimeout(tick, BOARD_INTERVAL_MS);
    };
    void tick();
    return () => {
      dead = true;
      ctl.abort();
      clearTimeout(timer);
    };
  }, []);

  const prices = useMemo(() => {
    if (!board) return null;
    const feeds = new Map(list.map((m) => [m.address.toLowerCase(), m.baseFeedId]));
    return new BoardPrices(board, ACTIVE.chainId, (p) => feeds.get(p.toLowerCase()));
  }, [board, list]);

  const value = useMemo(() => ({ board, prices, error, fetchedAt }), [board, prices, error, fetchedAt]);
  return <BoardCtx.Provider value={value}>{children}</BoardCtx.Provider>;
}

export function useBoard(): BoardState {
  const v = useContext(BoardCtx);
  if (!v) throw new Error("useBoard outside its provider");
  return v;
}

/** Unix seconds, re-rendering every `everyMs`. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

// ---------------------------------------------------------------------------------------------
// The wallet
// ---------------------------------------------------------------------------------------------

export interface WalletState {
  readonly address: Address | null;
  readonly isConnected: boolean;
  readonly provider: Eip1193 | null;
  /** The chain the wallet is on, or null. */
  readonly chainId: number | null;
  readonly wrongChain: boolean;
  /** Bazaar over the wallet's provider, once it is on the app's chain. */
  readonly walletBz: Bazaar | null;
  /** What kind of account connected; null while unknown. */
  readonly kind: AccountKind | null;
  /** Whether it can sign the gasless requests trading needs. */
  readonly canSign: boolean;
  readonly switchError: string | null;
  readonly openConnect: () => void;
  readonly openAccount: () => void;
  readonly disconnect: () => Promise<void>;
  /** Move the wallet to the app's chain; throws SwitchChainError with what to add. */
  readonly ensureChain: () => Promise<void>;
  /** Resolve once a wallet is connected on the right chain, opening the connect window if needed. */
  readonly requireWallet: () => Promise<{ address: Address; walletBz: Bazaar; provider: Eip1193 }>;
}

const WalletCtx = createContext<WalletState | null>(null);

function WalletProvider({ children }: { children: ReactNode }) {
  const { open } = useAppKit();
  const { address: rawAddress, isConnected } = useAppKitAccount({ namespace: "eip155" });
  const { chainId: rawChain } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider<Eip1193>("eip155");
  const { disconnect: appkitDisconnect } = useDisconnect();
  const { readBz } = useRead();

  const address = useMemo(() => (isConnected && rawAddress && /^0x[0-9a-fA-F]{40}$/.test(rawAddress) ? getAddress(rawAddress) : null), [isConnected, rawAddress]);
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletBz, setWalletBz] = useState<Bazaar | null>(null);
  const [kind, setKind] = useState<AccountKind | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const autoSwitched = useRef<string | null>(null);

  // The chain: AppKit's view, confirmed against the provider itself, and followed on chainChanged.
  useEffect(() => {
    const fromKit = typeof rawChain === "number" ? rawChain : typeof rawChain === "string" ? Number(rawChain) : null;
    setChainId(Number.isFinite(fromKit) ? fromKit : null);
    if (!walletProvider) return;
    let dead = false;
    const read = () =>
      walletProvider
        .request({ method: "eth_chainId" })
        .then((c) => !dead && setChainId(Number(BigInt(c as string))))
        .catch(() => undefined);
    void read();
    const onChain = (c: unknown) => !dead && setChainId(Number(BigInt(c as string)));
    walletProvider.on?.("chainChanged", onChain);
    return () => {
      dead = true;
      walletProvider.removeListener?.("chainChanged", onChain);
    };
  }, [walletProvider, rawChain]);

  const ensureChain = useCallback(async () => {
    if (!walletProvider) throw new Error("Connect a wallet first.");
    try {
      await switchToChain(walletProvider, ACTIVE);
      setSwitchError(null);
      setChainId(ACTIVE.chainId);
    } catch (e) {
      const msg = e instanceof SwitchChainError ? e.message : explain(e);
      setSwitchError(msg);
      throw e;
    }
  }, [walletProvider]);

  // Move a newly connected wallet to the app's chain once; after that the banner offers it.
  useEffect(() => {
    if (!address || !walletProvider || chainId === null || chainId === ACTIVE.chainId) return;
    if (autoSwitched.current === address) return;
    autoSwitched.current = address;
    ensureChain().catch(() => undefined);
  }, [address, walletProvider, chainId, ensureChain]);

  // The smart-wallet check after every connect: read the address's code from the public RPC.
  useEffect(() => {
    setKind(null);
    if (!address || !readBz) return;
    let dead = false;
    readBz.ctx.chain
      .code(address)
      .then((code) => !dead && setKind(classifyCode(code)))
      .catch(() => !dead && setKind("eoa"));
    return () => {
      dead = true;
    };
  }, [address, readBz]);

  // Bazaar over the wallet, rebuilt when the provider, account or chain changes.
  useEffect(() => {
    setWalletBz(null);
    if (!walletProvider || !address || chainId !== ACTIVE.chainId) return;
    let dead = false;
    Bazaar.connect({ transport: walletProvider as never, chainId: ACTIVE.chainId })
      .then((bz) => !dead && setWalletBz(bz))
      .catch((e) => {
        console.error("wallet connect", e);
        if (!dead) setSwitchError(explain(e));
      });
    return () => {
      dead = true;
    };
  }, [walletProvider, address, chainId]);

  const stateRef = useRef({ address, walletBz, walletProvider });
  stateRef.current = { address, walletBz, walletProvider };

  const requireWallet = useCallback(async () => {
    const s = stateRef.current;
    if (s.address && s.walletBz && s.walletProvider) return { address: s.address, walletBz: s.walletBz, provider: s.walletProvider };
    if (!s.address) {
      void open({ view: "Connect", namespace: "eip155" });
      throw new NeedsWalletError("Connect a wallet to continue.");
    }
    await ensureChain();
    // The connection is rebuilt by the effect above; wait for it briefly.
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const t = stateRef.current;
      if (t.address && t.walletBz && t.walletProvider) return { address: t.address, walletBz: t.walletBz, provider: t.walletProvider };
    }
    throw new NeedsWalletError(`Your wallet is not on ${ACTIVE.name} yet.`);
  }, [open, ensureChain]);

  const value = useMemo<WalletState>(
    () => ({
      address,
      isConnected: !!address,
      provider: walletProvider ?? null,
      chainId,
      wrongChain: !!address && chainId !== null && chainId !== ACTIVE.chainId,
      walletBz,
      kind,
      canSign: kind === null ? true : canSignRelayed(kind),
      switchError,
      openConnect: () => void open({ view: "Connect", namespace: "eip155" }),
      openAccount: () => void open({ view: "Account" }),
      disconnect: async () => {
        await appkitDisconnect({ namespace: "eip155" });
      },
      ensureChain,
      requireWallet,
    }),
    [address, walletProvider, chainId, walletBz, kind, switchError, open, appkitDisconnect, ensureChain, requireWallet],
  );
  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

/** No wallet yet: the connect window is open. Not shown as an error. */
export class NeedsWalletError extends Error {}

export function useWallet(): WalletState {
  const v = useContext(WalletCtx);
  if (!v) throw new Error("useWallet outside its provider");
  return v;
}

// ---------------------------------------------------------------------------------------------
// The relayer
// ---------------------------------------------------------------------------------------------

const RelayCtx = createContext<RelayService | null>(null);
const relayService = new RelayService(SERVICE_URL);

export function useRelayService(): RelayService {
  return useContext(RelayCtx) ?? relayService;
}

export function ConnectionProviders({ children }: { children: ReactNode }) {
  return (
    <RelayCtx.Provider value={relayService}>
      <ReadProvider>
        <BoardProvider>
          <WalletProvider>{children}</WalletProvider>
        </BoardProvider>
      </ReadProvider>
    </RelayCtx.Provider>
  );
}

export type { Hex };
