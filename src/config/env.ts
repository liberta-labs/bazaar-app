/** Public configuration from Vite's environment. Nothing here is secret: it ships in the bundle. */

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export const SERVICE_URL = trimSlash(import.meta.env.VITE_SERVICE_URL || "http://localhost:8080");
export const RPC_URL = import.meta.env.VITE_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";
export const REOWN_PROJECT_ID: string = import.meta.env.VITE_REOWN_PROJECT_ID || "";
