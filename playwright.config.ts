import { defineConfig, devices } from "@playwright/test";

// The config runs in Node, but the project carries no Node type definitions: the little it reads is typed here.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const CI = Boolean(env.CI);
// Not Vite's preview port (4173), which a preview of your own may already hold.
const PORT = Number(env.E2E_PORT || 4183);

/**
 * Browser smoke tests: each page of the production build renders, with no wallet connected, against the
 * live testnet and service. They serve `dist/` as it is, so build first: `npm run build && npm run e2e`.
 */
export default defineConfig({
  testDir: "e2e",
  // The pages read a public RPC and the service: one spec file, so one page at a time, and in CI another
  // go when the data is slow.
  retries: CI ? 2 : 0,
  forbidOnly: CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}/`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
