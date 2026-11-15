/**
 * Downloads stock logos from Logo.dev into public/stock-logos and lists them in src/lib/stockLogoFiles.ts,
 * for the market icons (src/components/AssetIcon.tsx).
 *
 *   npm run logos                the listed stock markets that have no logo yet
 *   npm run logos -- --all       then every other US stock Pyth has a feed for, until the credits run out
 *   npm run logos -- TSM KMX     just these tickers, downloaded again even if already stored
 *   npm run logos -- --dry       list what it would look up, without the key or spending credits
 *
 * It needs Logo.dev's secret key (sk_…) as LOGO_DEV_SECRET_KEY, in .env.logodev.local (gitignored) or in
 * the environment. The key is sent only to api.logo.dev and never printed.
 *
 * Each logo costs 2 API credits (2¢), and looking the same ticker up again within 24 hours is free. A ticker
 * Logo.dev has no logo for can still cost credits, so the script writes it down and waits before asking again
 * (MISSES below). The free plan includes $5 of credits a month, about 250 logos. When they run out Logo.dev
 * answers 402: the script stops there and keeps what it has, so run it again next month.
 * Logo.dev's terms let every plan store and serve the files its API returns (not copies of its CDN images);
 * on the free plan a commercial site must link to logo.dev, which the Markets page does under its table.
 *
 * Run through vite-node (the npm script does), so it reads the app's own network settings and ticker parsing.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Bazaar } from "@liberta-labs/bazaar-sdk";
import { RPC_URL } from "../src/config/env.ts";
import { ACTIVE } from "../src/config/networks.ts";
import { assetIconSpec } from "../src/lib/assetIcon.ts";
import { STOCK_LOGO_FILES } from "../src/lib/stockLogoFiles.ts";

const KEY_FILE = ".env.logodev.local";
const OUT_DIR = "public/stock-logos";
const MANIFEST = "src/lib/stockLogoFiles.ts";
/**
 * Tickers Logo.dev had no logo for, with the day to ask for each again: 30 days on for one it has no logo
 * for, and 7 for one it is still indexing, whose logo should come sooner. Until then the daily run skips it;
 * naming it on the command line asks anyway.
 */
const MISSES = "scripts/logo-misses.json";
const RETRY_DAYS = { missing: 30, indexing: 7 };
/** Pixels. The largest market icon is 24px, so this stays sharp at 4x. */
const SIZE = 96;
const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,11}$/;
/** Logo.dev allows 100 API requests a minute. */
const GAP_MS = 700;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function secretKey() {
  if (!process.env.LOGO_DEV_SECRET_KEY) {
    try {
      process.loadEnvFile(KEY_FILE);
    } catch {
      // No file: the message below says where the key goes.
    }
  }
  const key = process.env.LOGO_DEV_SECRET_KEY?.trim();
  if (!key) throw new Error(`No Logo.dev key. Put LOGO_DEV_SECRET_KEY=sk_… in ${KEY_FILE}, or set it in the environment.`);
  if (!key.startsWith("sk_")) throw new Error("LOGO_DEV_SECRET_KEY must be the secret key (sk_…), not the publishable one (pk_…).");
  return key;
}

/** The tickers of the stock markets listed on the app's network, read from the chain. */
async function listedStocks() {
  const bz = await Bazaar.connect({ transport: RPC_URL, chainId: ACTIVE.chainId });
  const list = await bz.markets.listMarkets();
  return list.map((m) => assetIconSpec(m.legSymbols[0], m.label)).filter((s) => s.kind === "stock").map((s) => s.ticker);
}

/** Every US stock and ETF Pyth publishes a price for. */
async function pythUsStocks() {
  const res = await fetch("https://hermes.pyth.network/v2/price_feeds?asset_type=equity");
  if (!res.ok) throw new Error(`Pyth's feed list answered HTTP ${res.status}.`);
  const feeds = await res.json();
  return feeds.map((f) => String(f?.attributes?.symbol ?? "")).filter((s) => s.startsWith("Equity.US.")).map((s) => assetIconSpec(s, s).ticker);
}

/**
 * One ticker's logo: { etag, transparent, bytes }, or "missing", "indexing" (Logo.dev is still building the
 * brand: try again later) or "no-credits".
 */
async function fetchLogo(key, ticker) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.logo.dev/v2/brands/logo?ticker=${encodeURIComponent(ticker)}`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 404) return "missing";
    if (res.status === 202) return "indexing";
    if (res.status === 402) return "no-credits";
    if (res.status === 401 || res.status === 403) throw new Error(`Logo.dev refused the key (HTTP ${res.status}). Check LOGO_DEV_SECRET_KEY.`);
    if (res.status === 429 && attempt < 5) {
      await sleep(Number(res.headers.get("retry-after") ?? 0) * 1000 || 30_000);
      continue;
    }
    if (!res.ok) throw new Error(`Logo.dev answered HTTP ${res.status} for ${ticker}.`);
    const { data } = await res.json();
    const url = new URL(String(data?.url ?? ""));
    if (url.protocol !== "https:" || typeof data?.etag !== "string") throw new Error(`Logo.dev's answer for ${ticker} has no usable download link.`);
    // The signed link is its own credential: no key goes with it.
    url.searchParams.set("size", String(SIZE));
    url.searchParams.set("format", "webp");
    const file = await fetch(url);
    // An expired link or a failed download must not replace a good copy.
    if (!file.ok || !file.headers.get("content-type")?.startsWith("image/webp")) throw new Error(`The download of ${ticker}'s logo failed (HTTP ${file.status}).`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 200_000) throw new Error(`${ticker}'s logo came back ${bytes.length} bytes long.`);
    return { etag: data.etag, transparent: data.source?.has_transparency === true, bytes };
  }
}

function manifestSource(files) {
  const rows = Object.keys(files)
    .sort()
    .map((t) => `  ${JSON.stringify(t)}: { etag: ${JSON.stringify(files[t].etag)}, transparent: ${files[t].transparent} },`);
  return `// Written by scripts/fetch-stock-logos.mjs: run it (npm run logos) rather than editing this by hand.
// The stock logos downloaded from Logo.dev into public/stock-logos, by ticker: the version's etag, and
// whether the logo has a transparent background.

export interface StockLogoFile {
  readonly etag: string;
  readonly transparent: boolean;
}

export const STOCK_LOGO_FILES: Readonly<Record<string, StockLogoFile>> = {
${rows.join("\n")}
};
`;
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const dry = args.includes("--dry");
  const named = args.filter((a) => !a.startsWith("--")).map((a) => a.toUpperCase());
  const key = dry ? "" : secretKey();
  const files = { ...STOCK_LOGO_FILES };
  const misses = JSON.parse(await readFile(MISSES, "utf8").catch(() => "{}"));
  const today = new Date().toISOString().slice(0, 10);
  const daysOn = (days) => new Date(Date.parse(today) + days * 86_400_000).toISOString().slice(0, 10);
  // ISO days compare as text.
  const waiting = (t) => typeof misses[t] === "string" && today < misses[t];

  let queue;
  if (named.length) queue = named;
  else {
    const listed = await listedStocks();
    console.log(`${listed.length} stock markets listed on ${ACTIVE.name}.`);
    queue = [...listed, ...(all ? await pythUsStocks() : [])].filter((t) => !files[t] && !waiting(t));
  }
  queue = [...new Set(queue)].filter((t) => TICKER.test(t));
  if (!queue.length) return console.log("Nothing to look up: every stock in scope has a logo or waits to be asked again.");
  if (dry) return console.log(`Would look up ${queue.length} tickers: ${queue.join(" ")}`);
  console.log(`Looking up ${queue.length} tickers on Logo.dev.`);

  await mkdir(OUT_DIR, { recursive: true });
  const missing = [];
  const indexing = [];
  let saved = 0;
  try {
    for (const ticker of queue) {
      // A class share is BRK-B on Pyth and may be BRK.B elsewhere.
      let got = await fetchLogo(key, ticker);
      if (got === "missing" && ticker.includes("-")) got = await fetchLogo(key, ticker.replaceAll("-", "."));
      if (got === "no-credits") {
        console.log("Out of Logo.dev credits for this month. Run it again when they renew; it carries on from here.");
        break;
      }
      if (got === "missing") {
        missing.push(ticker);
        misses[ticker] = daysOn(RETRY_DAYS.missing);
      } else if (got === "indexing") {
        indexing.push(ticker);
        misses[ticker] = daysOn(RETRY_DAYS.indexing);
      } else {
        delete misses[ticker];
        await writeFile(`${OUT_DIR}/${ticker}.webp`, got.bytes);
        files[ticker] = { etag: got.etag, transparent: got.transparent };
        saved++;
        console.log(`  ${ticker}`);
      }
      await sleep(GAP_MS);
    }
  } finally {
    if (saved) await writeFile(MANIFEST, manifestSource(files));
    if (saved || missing.length || indexing.length) {
      const sorted = Object.fromEntries(Object.entries(misses).sort(([a], [b]) => a.localeCompare(b)));
      await writeFile(MISSES, `${JSON.stringify(sorted, null, 2)}\n`);
    }
    console.log(`Saved ${saved} logos (${Object.keys(files).length} in all).`);
    if (missing.length) console.log(`No logo on Logo.dev, asked again in ${RETRY_DAYS.missing} days: ${missing.join(" ")}`);
    if (indexing.length) console.log(`Still being indexed, asked again in ${RETRY_DAYS.indexing} days: ${indexing.join(" ")}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
