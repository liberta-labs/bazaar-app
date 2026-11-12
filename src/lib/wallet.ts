/**
 * Wallet checks that sit outside the SDK: what kind of account connected, and moving the wallet to
 * the app's chain.
 */
import { toHex } from "viem";
import type { Address, Hex } from "viem";
import type { AppNetwork } from "../config/networks";

/** An EIP-1193 provider, as AppKit hands it over. */
export interface Eip1193 {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * - `eoa`: no code, an ordinary account.
 * - `delegated`: an EIP-7702 delegation (code 0xef0100 + address). It still signs with its own key.
 * - `contract`: a smart-contract wallet (Safe, Argent, Coinbase Smart Wallet). It signs through
 *   ERC-1271, which the pair's plain ECDSA check does not accept, so it cannot sign gasless requests.
 */
export type AccountKind = "eoa" | "delegated" | "contract";

export function classifyCode(code: Hex | string | null | undefined): AccountKind {
  const c = (code ?? "0x").toLowerCase();
  if (c === "0x" || c === "0x0" || c === "") return "eoa";
  if (c.startsWith("0xef0100")) return "delegated";
  return "contract";
}

/** Whether an account of this kind can sign the plain signature the relayer needs. */
export const canSignRelayed = (k: AccountKind) => k !== "contract";

export async function accountKind(rpc: Eip1193, address: Address): Promise<AccountKind> {
  return classifyCode((await rpc.request({ method: "eth_getCode", params: [address, "latest"] })) as Hex);
}

/** Why a smart-contract wallet cannot do an action, for a disabled button's tooltip. */
export const CONTRACT_WALLET_REASON =
  "Smart-contract wallets can't sign the gasless request this action needs (only the relayer can attach the fresh price it carries). Connect an ordinary wallet such as MetaMask to do this.";

/** The wallet could not move to the chain: say which network to add, rather than failing quietly. */
export class SwitchChainError extends Error {
  constructor(readonly net: AppNetwork) {
    super(
      `Your wallet could not switch to ${net.name}. Add it in your wallet's network settings: network name ${net.name}, chain ID ${net.chainId}, RPC URL ${net.rpcUrl}, currency ${net.nativeCurrency.symbol}, block explorer ${net.explorer}. Then try again.`,
    );
  }
}

const codeOf = (e: unknown): number | undefined => {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur && typeof cur === "object"; i++) {
    const c = (cur as { code?: unknown }).code;
    if (typeof c === "number") return c;
    const data = (cur as { data?: { originalError?: { code?: unknown } } }).data;
    if (typeof data?.originalError?.code === "number") return data.originalError.code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
};

/** Move the wallet to `net`, adding the network first when the wallet does not know it (4902). */
export async function switchToChain(wallet: Eip1193, net: AppNetwork): Promise<void> {
  const chainId = toHex(net.chainId);
  try {
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    return;
  } catch (e) {
    if (codeOf(e) === 4001) throw e;
    // 4902 is the standard "unknown chain"; some mobile wallets answer -32603 or nothing useful instead.
  }
  try {
    await wallet.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId, chainName: net.name, rpcUrls: [net.rpcUrl], nativeCurrency: net.nativeCurrency, blockExplorerUrls: [net.explorer] }],
    });
    await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (e) {
    if (codeOf(e) === 4001) throw e;
    throw new SwitchChainError(net);
  }
}

/** The chain the wallet is on now. */
export async function walletChainId(wallet: Eip1193): Promise<number> {
  return Number(BigInt((await wallet.request({ method: "eth_chainId" })) as string));
}
