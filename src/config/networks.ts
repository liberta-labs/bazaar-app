/**
 * The networks the app runs on. Adding Arbitrum One once its deployment exists is one entry here
 * (and turning it on in ENABLED_CHAINS): the SDK's preset already carries its factory and subgraph.
 */
import { arbitrum, arbitrumSepolia } from "@reown/appkit/networks";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { RPC_URL, RPC_WS_URLS } from "./env";

export interface AppNetwork {
  readonly chainId: number;
  readonly name: string;
  /** Shows the Testnet badge and the faucet. */
  readonly testnet: boolean;
  /** JSON-RPC for read-only browsing, and what wallet_addEthereumChain offers. */
  readonly rpcUrl: string;
  /**
   * Free public WebSocket RPCs, used only to hear of each new block at once (lib/headsTransport.ts): every
   * read still goes to rpcUrl. In order of preference; empty, the page polls.
   */
  readonly headsWsUrls: readonly string[];
  readonly explorer: string;
  readonly nativeCurrency: { name: string; symbol: string; decimals: number };
  /** What AppKit knows the chain as. */
  readonly appkit: AppKitNetwork;
  /** Free faucets for the chain's test ETH (testnet only). */
  readonly gasFaucets?: readonly { readonly name: string; readonly url: string }[];
}

export const NETWORKS: Readonly<Record<number, AppNetwork>> = {
  421614: {
    chainId: 421614,
    name: "Arbitrum Sepolia",
    testnet: true,
    rpcUrl: RPC_URL,
    headsWsUrls: RPC_WS_URLS ?? ["wss://arbitrum-sepolia.drpc.org", "wss://arbitrum-sepolia-rpc.publicnode.com"],
    explorer: "https://sepolia.arbiscan.io",
    nativeCurrency: { name: "Arbitrum Sepolia Ether", symbol: "ETH", decimals: 18 },
    appkit: arbitrumSepolia,
    gasFaucets: [
      { name: "Alchemy", url: "https://www.alchemy.com/faucets/arbitrum-sepolia" },
      { name: "Chainlink", url: "https://faucets.chain.link/arbitrum-sepolia" },
    ],
  },
  42161: {
    chainId: 42161,
    name: "Arbitrum One",
    testnet: false,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    headsWsUrls: RPC_WS_URLS ?? ["wss://arbitrum.drpc.org", "wss://arbitrum-one-rpc.publicnode.com"],
    explorer: "https://arbiscan.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    appkit: arbitrum,
  },
};

/** The chains the app serves now. Arbitrum One joins once its preset has a factory. */
export const ENABLED_CHAINS: readonly number[] = [421614];

/** The chain the app connects to. */
export const ACTIVE: AppNetwork = NETWORKS[ENABLED_CHAINS[0]!]!;

export const txUrl = (hash: string, net: AppNetwork = ACTIVE) => `${net.explorer}/tx/${hash}`;
export const addressUrl = (a: string, net: AppNetwork = ACTIVE) => `${net.explorer}/address/${a}`;
