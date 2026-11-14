/**
 * Reown AppKit: one connect window for browser-extension wallets (every wallet that announces itself
 * through EIP-6963, MetaMask first), phone or desktop wallets over WalletConnect, and email or social
 * login. A login makes a wallet Reown keeps for the user; it is a plain (EOA) wallet, not AppKit's
 * default smart account, because the pairs check a gasless request's signature against the account's
 * own key, which a smart account doesn't have. Its wallet still asks to approve each signature, in
 * AppKit's own window. Swaps and on-ramp are off.
 *
 * The adapter is Reown's Wagmi adapter, as its React docs recommend. Nothing reads or writes through
 * wagmi: the app takes the wallet's EIP-1193 provider (useAppKitProvider) and hands it to the SDK.
 */
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { createAppKit } from "@reown/appkit/react";
import { REOWN_PROJECT_ID } from "../config/env";
import { ACTIVE, ENABLED_CHAINS, NETWORKS } from "../config/networks";

/** MetaMask's id in WalletConnect's wallet registry. */
export const METAMASK_WALLET_ID = "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96";

const networks = ENABLED_CHAINS.map((id) => NETWORKS[id]!.appkit) as [AppKitNetwork, ...AppKitNetwork[]];

/** WalletConnect cannot start without a project id; extension wallets still connect. */
export const HAS_PROJECT_ID = REOWN_PROJECT_ID.length > 0;

export const wagmiAdapter = new WagmiAdapter({ networks, projectId: REOWN_PROJECT_ID || "missing-project-id" });

const origin = typeof window !== "undefined" ? window.location.origin : "https://bazaar.finance";

/**
 * The icon wallets show for this app. An email or social login's signature window runs on Reown's own
 * https site, which can't load an image from http://localhost (the browser upgrades it to https, and
 * that fails), so a local run points at the deployed copy.
 */
const ICON_URL = origin.startsWith("https://") ? `${origin}/bazaar-icon.png` : "https://app.bazaar.finance/bazaar-icon.png";

export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks,
  defaultNetwork: ACTIVE.appkit,
  projectId: REOWN_PROJECT_ID || "missing-project-id",
  metadata: {
    name: "Bazaar",
    description: "Perpetual futures on Arbitrum, with an insurance fund for every market",
    url: origin,
    // Shown on connect prompts, WalletConnect sessions and signature requests.
    icons: [ICON_URL],
  },
  // Email and social logins as plain (EOA) wallets: AppKit's default for them is a smart account, which
  // the pairs can't verify. Settings saved in the project's Reown dashboard override the two switches below.
  defaultAccountTypes: { eip155: "eoa" },
  features: {
    email: true,
    socials: ["google", "x", "discord", "apple", "github"],
    swaps: false,
    onramp: false,
    send: false,
    history: false,
    analytics: false,
    connectorTypeOrder: ["injected", "featured", "recent", "walletConnect", "recommended", "custom", "external"],
  },
  featuredWalletIds: [METAMASK_WALLET_ID],
  enableEIP6963: true,
  enableInjected: true,
  enableWalletConnect: HAS_PROJECT_ID,
  enableCoinbase: true,
  // Coinbase's smart wallet signs through ERC-1271, which the relayer cannot use.
  coinbasePreference: "eoaOnly",
  allowUnsupportedChain: true,
  // ThemeProvider keeps this in step with the page; this is the theme index.html applied before load.
  themeMode: typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark",
  themeVariables: {
    "--w3m-accent": "#f5c518",
    "--w3m-color-mix": "#0a0a0a",
    "--w3m-color-mix-strength": 30,
    "--w3m-border-radius-master": "2px",
    "--w3m-font-family": "Inter, system-ui, sans-serif",
  },
});
