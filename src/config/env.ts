/** Public configuration from Vite's environment. Nothing here is secret: it ships in the bundle. */

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export const SERVICE_URL = trimSlash(import.meta.env.VITE_SERVICE_URL || "http://localhost:8080");
export const RPC_URL = import.meta.env.VITE_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
/**
 * A subgraph the page may query itself when the service cannot answer history: optional, and public like
 * every value here, so never one with an API key. Unset, the official deployment's public subgraph.
 */
export const SUBGRAPH_URL: string | null = import.meta.env.VITE_SUBGRAPH_URL ? trimSlash(import.meta.env.VITE_SUBGRAPH_URL) : null;
export const REOWN_PROJECT_ID: string = import.meta.env.VITE_REOWN_PROJECT_ID || "";
