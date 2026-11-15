/** Public configuration from Vite's environment. Nothing here is secret: it ships in the bundle. */

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export const SERVICE_URL = trimSlash(import.meta.env.VITE_SERVICE_URL || "http://localhost:8080");
export const RPC_URL = import.meta.env.VITE_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
/**
 * WebSocket RPCs the page learns of new blocks from (lib/headsTransport.ts), comma-separated in order of
 * preference; "none" turns them off and the page polls. Unset, the network's free public ones. Public like
 * every value here, so never one with an API key.
 */
export const RPC_WS_URLS: readonly string[] | null = (() => {
  const v = (import.meta.env.VITE_RPC_WS_URLS ?? "").trim();
  if (!v) return null;
  return v.toLowerCase() === "none" ? [] : v.split(",").map((u: string) => u.trim()).filter(Boolean);
})();
/**
 * A subgraph the page may query itself when the service cannot answer history: optional, and public like
 * every value here, so never one with an API key. Unset, the official deployment's public subgraph.
 */
export const SUBGRAPH_URL: string | null = import.meta.env.VITE_SUBGRAPH_URL ? trimSlash(import.meta.env.VITE_SUBGRAPH_URL) : null;
export const REOWN_PROJECT_ID: string = import.meta.env.VITE_REOWN_PROJECT_ID || "";
