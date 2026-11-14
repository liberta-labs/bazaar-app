import { test as base, expect, type Page } from "@playwright/test";

export { expect };

/** How long to wait for what the chain or the service has to answer first: markets, the book, the leaderboard. */
export const DATA_TIMEOUT = 60_000;

/**
 * Uncaught errors that are a third party's network failing, not the app: WalletConnect's relay and API,
 * an RPC or the service out of reach or rate limited. These come and go on a test runner's network and
 * say nothing about whether a page renders; any other uncaught error fails the test.
 */
const NETWORK_NOISE = [
  /failed to fetch/i,
  /networkerror/i,
  /load failed/i,
  /network request failed/i,
  /websocket/i,
  /\bnet::ERR_/,
  /HTTP request failed/i,
  /request took too long/i,
  /status:? 429/i,
  /walletconnect|reown|web3modal/i,
  /origin .* not (found|allowed)|allowlist/i,
];

const isNoise = (e: Error) => NETWORK_NOISE.some((re) => re.test(`${e.message}\n${e.stack ?? ""}`));

/**
 * Every test fails on an uncaught page error (`pageerror`: an exception or an unhandled rejection),
 * other than a third party's network failing. Ignored ones are noted on the test.
 */
export const test = base.extend<{ pageErrors: Error[] }>({
  pageErrors: [
    async ({ page }, use, info) => {
      const errors: Error[] = [];
      page.on("pageerror", (e) => errors.push(e));
      await use(errors);
      const real = errors.filter((e) => !isNoise(e));
      for (const e of errors.filter(isNoise)) info.annotations.push({ type: "ignored page error", description: e.message });
      expect(real.map((e) => e.stack || e.message), "uncaught errors on the page").toEqual([]);
    },
    { auto: true },
  ],
});

/** The markets table, once the chain has answered: at least one market row. */
export async function expectMarketList(page: Page) {
  const panel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: "Markets", exact: true }) });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("columnheader", { name: "Market" })).toBeVisible({ timeout: DATA_TIMEOUT });
  const rows = panel.locator("tbody tr");
  await expect(rows.first()).toBeVisible({ timeout: DATA_TIMEOUT });
  expect(await rows.count()).toBeGreaterThan(0);
}

/** The first market's address, from the first link to a market page (the Trade link or the ticker). */
export async function firstMarketAddress(page: Page): Promise<string> {
  const link = page.locator('a[href*="/market/0x"]').first();
  await expect(link).toBeAttached({ timeout: DATA_TIMEOUT });
  const href = (await link.getAttribute("href")) ?? "";
  const m = /\/market\/(0x[0-9a-fA-F]{40})/.exec(href);
  expect(m, `a market address in ${href}`).not.toBeNull();
  return m![1]!;
}
