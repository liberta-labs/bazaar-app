import { DATA_TIMEOUT, expect, expectMarketList, firstMarketAddress, test } from "./fixtures";

// Each page renders with no wallet connected. The data is live (Arbitrum Sepolia and the service), so
// these check what is on the page, not what it says.

test("the home page lists the markets", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
  await expect(page.locator("header").getByRole("button", { name: "Connect", exact: true })).toBeVisible();
  await expectMarketList(page);
});

test("the Markets link lists the markets", async ({ page }) => {
  await page.goto("./#/leaderboard");
  await page.locator("header").getByRole("link", { name: "Markets", exact: true }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expectMarketList(page);
});

test("a market page shows its header, chart, order book and order ticket", async ({ page }) => {
  await page.goto("./");
  const address = await firstMarketAddress(page);
  await page.goto(`./#/market/${address}`);

  // The market's header: its name, which opens the list of markets.
  const bar = page.locator(".market-bar");
  await expect(bar).toBeVisible({ timeout: DATA_TIMEOUT });
  await expect(bar.locator(".market-pick-btn")).toBeVisible();

  // The chart panel: its intervals over a drawn chart.
  const chart = page.locator(".t-chart");
  await expect(chart).toBeVisible();
  expect(await chart.locator(".chart-toolbar button").count()).toBeGreaterThan(0);
  await expect(chart.locator(".chart-box canvas").first()).toBeAttached();
  const box = await chart.locator(".chart-box").boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(100);
  expect(box?.height ?? 0).toBeGreaterThan(100);

  // The order book, once read: its levels, or the empty book.
  const book = page.locator(".t-book");
  await expect(book.getByRole("tab", { name: "Order book" })).toBeVisible();
  await expect(book.getByRole("table", { name: "Order book" }).or(book.getByText("The book is empty"))).toBeVisible({ timeout: DATA_TIMEOUT });

  // The order ticket, asking for a wallet.
  const ticket = page.locator(".t-side section.panel").first();
  await expect(ticket.getByRole("radiogroup", { name: "Side" })).toBeVisible();
  await expect(ticket.getByRole("button", { name: "Connect to trade" })).toBeVisible();
});

test("the portfolio asks for a wallet", async ({ page }) => {
  await page.goto("./#/portfolio");
  const prompt = page.locator(".empty").filter({ hasText: "Connect to see your portfolio" });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole("button", { name: "Connect", exact: true })).toBeVisible();
});

test("the proposals page renders", async ({ page }) => {
  await page.goto("./#/proposals");
  await expect(page.getByRole("heading", { level: 1, name: "Proposals" })).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "Kind of proposal" });
  await expect(tabs.getByRole("tab", { name: "Market listings", selected: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Market listings" })).toBeVisible();
});

test("the leaderboard renders", async ({ page }) => {
  await page.goto("./#/leaderboard");
  await expect(page.getByRole("heading", { level: 1, name: /Leaderboard/ })).toBeVisible();
  // It settles on the board (standings, and your progress asking for a wallet), "not ready yet", or the
  // service's error with a retry.
  const settled = page
    .getByRole("heading", { level: 2, name: /Standings/ })
    .or(page.getByText("The leaderboard isn't ready yet"))
    .or(page.locator(".lb").getByRole("button", { name: "Try again" }));
  await expect(settled.first()).toBeVisible({ timeout: DATA_TIMEOUT });
  await expect(page.getByText("Loading the leaderboard…")).toBeHidden();
});
