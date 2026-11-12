# Bazaar app

A web app for the Bazaar protocol: perpetual futures on Arbitrum, priced by Pyth Pro, with an
insurance fund for every market. Traders deposit, trade and close positions; insurers join and leave
market insurance funds; anyone can take part in governance. It is a static site (Vite, React,
TypeScript) with no backend and no secrets.

It talks to:

- the user's wallet (browser extensions through EIP-6963, phone and desktop wallets over
  WalletConnect, both through Reown AppKit);
- a JSON-RPC endpoint, for browsing before a wallet connects;
- Bazaar's subgraph, for history;
- the price board and relayer service (`bazaar-relayer-priceboard`), for display prices and gasless
  transactions.

Every chain read, transaction, signature and history query goes through `@liberta-labs/bazaar-sdk`.

## Running it

Node 20 or later. Until the SDK is on npm, it is installed from a sibling checkout:

```bash
cd ../bazaar-sdk/packages/sdk && npx tsc -b && cd -
```

```bash
npm install
```

```bash
cp .env.example .env
```

Fill in `.env` (every value is public; it ends up in the bundle):

| Variable | Default | Meaning |
|---|---|---|
| `VITE_SERVICE_URL` | `http://localhost:8080` | The price board and relayer service. The deployed one is `https://bazaar-relayer-priceboard.fly.dev`, which `.env.production` sets for `npm run build`. |
| `VITE_RPC_URL` | `https://sepolia-rollup.arbitrum.io/rpc` | JSON-RPC for read-only browsing. |
| `VITE_REOWN_PROJECT_ID` | none | Reown project ID. Without it, browser wallets still connect but WalletConnect (phone wallets) does not. Allowlist the app's domains in Reown's dashboard. |

With the deployed service in `.env`, nothing else needs to run. To use a service of your own instead, start it (see its README, "Running it") and set `VITE_SERVICE_URL=http://localhost:8080`. Then:

```bash
npm run dev
```

The app opens on http://localhost:5173. A static build for any host:

```bash
npm run build
```

`dist/` is self-contained: hash routes and relative asset paths, so it runs from any folder of any
static host with no rewrite rules.

## Deploying

Every push to `main` builds the app and deploys it to the Cloudflare Pages project `bazaar-app`
([.github/workflows/deploy.yml](.github/workflows/deploy.yml)). It checks out the SDK beside the app,
builds it, runs the typecheck, lint and tests, builds the app and uploads `dist/` with wrangler. It can
also be run by hand from the Actions tab.

In the GitHub repository's Settings > Secrets and variables > Actions:

| Name | Kind | Value |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | A Cloudflare API token with the Cloudflare Pages: Edit permission. |
| `CLOUDFLARE_ACCOUNT_ID` | secret | The Cloudflare account the Pages project is in. |
| `VITE_REOWN_PROJECT_ID` | variable | The Reown project ID. It is public (it ships in the bundle). The build fails without it. |

`VITE_SERVICE_URL` comes from `.env.production`. Allow the app's domains (app.bazaar.finance and the
project's pages.dev domain) in Reown's dashboard.

By hand, from this folder, with `VITE_REOWN_PROJECT_ID` in `.env`:

```bash
npm run build && npx wrangler pages deploy dist --project-name bazaar-app --branch main
```

## Checks

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

The unit tests cover the board adapter (`test/board.test.ts`), the relay flow with every status the
relayer answers (`test/relay.test.ts`), the insurance return estimate (`test/insuranceReturn.test.ts`)
and the smart-wallet check (`test/wallet.test.ts`).

## How it is put together

| Where | What |
|---|---|
| `src/config/networks.ts` | The networks. Arbitrum Sepolia is on; Arbitrum One is one entry, enabled by adding its chain id to `ENABLED_CHAINS` once its SDK preset has a factory. The Testnet badge and the faucet follow `testnet`. |
| `src/state/appkit.ts` | Reown AppKit: EIP-6963 extension wallets (MetaMask first) and WalletConnect; email, socials, swaps and on-ramp off; Coinbase limited to its ordinary (EOA) wallet. |
| `src/state/connection.tsx` | The read-only connection over the RPC URL, the wallet's connection (its EIP-1193 provider passed to `Bazaar.connect` and as `wallet` for signing and sending), chain switching, the smart-wallet check, and the board, polled every 10 seconds. |
| `src/lib/board.ts` | `/board.json` parsed into 18-decimal bigints, and `BoardPrices`, the SDK's `LivePriceView` over it. Passed as `prices` to every read that takes it. |
| `src/lib/relay.ts` | The gasless path: fee quote (re-quoted after `validForSeconds`), `signRelayed`, post at once, and every relayer status (202, 402, 409, 422, 4xx, 5xx) turned into an answer or an error the UI can act on. |
| `src/state/tx.tsx` | Every write in one modal: confirmation, per-step progress with Arbiscan links, "sign again" when a signature expires, re-signing at the new fee after a 402, and "send from my wallet" when the relayer is down (deposit, cancel, insurance request). One relayed request per market at a time. |
| `src/lib/jobs.ts` | Which action goes which way: priced actions always relayed; deposit, cancel and insurance request relayed with a wallet fallback; claims, the faucet and governance from the wallet. |
| `src/lib/insuranceReturn.ts` | The insurance return estimate: the fund's share of 30 days of fees (integrator legs and the 1% bug-bounty skim taken out, via the SDK's `feeBreakdown`) over the fund's value, annualized. |
| `src/components/PriceChart.tsx` | All chart code (TradingView Lightweight Charts, attribution logo on), so it can be swapped. |

Smart-contract wallets (Safe, Argent, Coinbase Smart Wallet) can browse, deposit collateral, cancel
orders and request an insurance withdrawal, all sent from the wallet. Placing and amending orders,
withdrawing collateral, depositing into insurance and finishing an insurance exit need a gasless
signature they cannot make; those buttons are disabled with a tooltip, and a notice says so once.

## The testnet run

With the service running locally and `.env` filled in, each of these should then show in history
(the subgraph trails the chain by a few seconds; the app says so when it falls further behind):

1. Connect MetaMask; separately, connect a phone wallet by QR code.
2. Get test USDC (header button; needs a little Arbitrum Sepolia ETH for gas), then open a market
   and deposit (Deposit / Withdraw tab).
3. Place a limit order below the market (Trade, Limit), then cancel it (open orders on the market
   page or the Portfolio).
4. Open a position with a market order, then close it (Close in the position row).
5. On Earn, insure a market, then request a withdrawal in "My insurance".
