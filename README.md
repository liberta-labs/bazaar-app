# Bazaar app

A web app for the Bazaar protocol: perpetual futures on Arbitrum, priced by Pyth Pro, with an
insurance fund for every market. Traders deposit, trade and close positions; insurers join and leave
market insurance funds; anyone can take part in governance. It is a static site (Vite, React,
TypeScript) with no backend and no secrets.

It talks to:

- the user's wallet (browser extensions through EIP-6963, phone and desktop wallets over
  WalletConnect, both through Reown AppKit);
- a JSON-RPC endpoint, for browsing before a wallet connects;
- the price board and relayer service (`bazaar-relayer-priceboard`), for display prices, gasless
  transactions and history. The service asks Bazaar's subgraph on the page's behalf and answers every
  visitor from one short cache, so the page holds no subgraph key and the subgraph's load does not grow
  with the audience.

Those are the page's only two addresses: an RPC URL and the service's. [Running your own](#running-your-own)
shows how to stand up a copy.

Every chain read, transaction, signature and history query goes through `@liberta-labs/bazaar-sdk`.

## Running it

Node 20 or later. Until the SDK is on npm, the app takes it from a checkout of
[bazaar-sdk](https://github.com/liberta-labs/bazaar-sdk) in the folder beside it
(`file:../bazaar-sdk/packages/sdk` in `package.json`), so clone both side by side:

```bash
git clone https://github.com/liberta-labs/bazaar-sdk.git
```

```bash
git clone https://github.com/liberta-labs/bazaar-app.git
```

Build the SDK once, and again after pulling SDK changes:

```bash
cd bazaar-sdk && npm ci --ignore-scripts && npx tsc -b packages/sdk && cd ..
```

Then, in `bazaar-app`:

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
| `VITE_SUBGRAPH_URL` | the official deployment's | Optional. A subgraph the page queries itself only when the service cannot answer history. Never one with an API key. |
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
builds it, runs the typecheck, lint and tests, builds the app, opens each page of the build in Chromium
(the browser smoke tests below) and uploads `dist/` with wrangler. A failing step stops the deploy. It can
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

## Running your own

The app is a folder of static files plus one service. There are two ways to run a copy.

**The frontend alone.** Fork this repository, change what you like, and host `dist/` anywhere (Cloudflare
Pages, Netlify, GitHub Pages, S3, IPFS). Keep `VITE_SERVICE_URL` pointed at a running service; the
official one answers any origin, and its per-address limits apply to your visitors as to anyone's. You
need:

1. a Reown project ID of your own (free, [dashboard.reown.com](https://dashboard.reown.com)), with your
   domain allowed, in `VITE_REOWN_PROJECT_ID`;
2. `npm run build`, and somewhere to put `dist/`.

Nothing else: no server, no database, no API key.

**The whole stack.** Run the service yourself as well. Its repository, `bazaar-relayer-priceboard`, is
not public yet; until it is, run the frontend alone against the deployed service. It is one container,
configured by environment variables (its `.env.example` lists them), with a `Dockerfile` and a `fly.toml`
ready for Fly.io. It needs:

1. a Pyth Pro API key (`PYTH_PRO_TOKEN`), for prices;
2. an RPC URL and the factory address of the deployment it follows;
3. a fresh wallet key with a little ETH (`TESTNET_RELAYER_KEY`), to relay gasless transactions;
4. optionally a subgraph endpoint and key of your own (`TESTNET_SUBGRAPH_URL`,
   `TESTNET_SUBGRAPH_API_KEY`). Without them it uses the official deployment's public subgraph, which is
   rate-limited.

Then set `VITE_SERVICE_URL` to your service and build. Every key stays on the service; the page ships
none.

| The page gets | From | How often |
|---|---|---|
| Prices, 24-hour change, 24-hour volume, the subgraph's lag | `GET /board.json` on the service | every 10 seconds, one small cacheable file |
| Order book, positions, open orders, balances | the chain, over the RPC URL | live |
| Charts, trades, order and account history, proposals | `POST /subgraph/<chainId>` on the service | when a page opens; charts refresh once a candle |
| Gasless transactions, test USDC | `POST /relay`, `POST /faucet` on the service | on the user's action |

All of it stops while nobody is using the page: while its tab is hidden, and after 15 minutes without
input (a bar then says so, and any click, key or scroll resumes). A forgotten tab costs nothing.

If the service does not answer history (an older one, or one set up without a subgraph), the page
falls back to asking the subgraph itself, at `VITE_SUBGRAPH_URL` or the official public one.

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

The unit tests cover the board adapter (`test/board.test.ts`), history through the service with its
fallback (`test/subgraph.test.ts`), the relay flow with every status the relayer answers
(`test/relay.test.ts`), the insurance return estimate (`test/insuranceReturn.test.ts`)
and the smart-wallet check (`test/wallet.test.ts`).

Browser smoke tests (Playwright, in `e2e/`) serve the production build with `vite preview` and open each
page with no wallet connected: the markets list, a market's header, chart, order book and order ticket,
the portfolio's wallet prompt, proposals and the leaderboard. Any uncaught error on a page fails them,
apart from a third party's network failing (WalletConnect, an RPC out of reach). They read the live testnet
and service, so they check what is on each page, not the numbers. Build first; Chromium is installed once:

```bash
npx playwright install chromium
```

```bash
npm run build && npm run e2e
```

## How it is put together

| Where | What |
|---|---|
| `src/config/networks.ts` | The networks. Arbitrum Sepolia is on; Arbitrum One is one entry, enabled by adding its chain id to `ENABLED_CHAINS` once its SDK preset has a factory. The Testnet badge and the faucet follow `testnet`. |
| `src/state/appkit.ts` | Reown AppKit: EIP-6963 extension wallets (MetaMask first), WalletConnect, and email and social logins (as ordinary EOA accounts); swaps and on-ramp off; Coinbase limited to its ordinary (EOA) wallet. |
| `src/state/connection.tsx` | The read-only connection over the RPC URL, the wallet's connection (its EIP-1193 provider passed to `Bazaar.connect` and as `wallet` for signing and sending), chain switching, the smart-wallet check, and the board, polled every 10 seconds. |
| `src/lib/board.ts` | `/board.json` parsed into 18-decimal bigints, and `BoardPrices`, the SDK's `LivePriceView` over it. Passed as `prices` to every read that takes it. It also carries each market's price 24 hours ago, its 24-hour volume and the subgraph's lag, so the page asks the subgraph for none of them. |
| `src/lib/subgraph.ts` | Where history comes from: the service's `/subgraph/<chainId>` route, given to `Bazaar.connect` as its subgraph, with the public subgraph as the fallback. |
| `src/state/activity.tsx` | Whether anyone is using the page: false while its tab is hidden, and after 15 minutes without input, when a bar says updates are paused. Any click, key, scroll or mouse movement resumes them. |
| `src/state/poll.ts` | Polling that runs only while the page is in use, and catches up at once when it is used again. Every poller (the board, market snapshots, the chain's head, charts) goes through it, and the live account and market watchers stop and restart with it. |
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

## License

The code is [MIT](LICENSE), like the [SDK](https://github.com/liberta-labs/bazaar-sdk). The license does
not grant use of the Bazaar name or logos (`public/bazaar-*.png`); a copy you host should use its own.
Nor does it cover the company logos in `public/stock-logos/`: they belong to their companies and are
downloaded from [Logo.dev](https://www.logo.dev) under its terms (`npm run logos`, run daily by the
Stock logos workflow). A copy you host should download its own with its own Logo.dev key.

Dependencies keep their own licenses. Two that ship in the built site are not open source: Reown AppKit
(wallet connection, under the Reown Community License) and the MetaMask SDK (under ConsenSys's terms). A
copy you host uses them under those vendors' terms, not this repository's.
