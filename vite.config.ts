import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The config runs in Node, but the project carries no Node type definitions: the few calls it makes
// are typed here. process.getBuiltinModule is Node 20.16+; without it, old caches are simply kept.
type Fs = { readdirSync(path: string): string[]; rmSync(path: string, opts: { recursive: boolean; force: boolean }): void };
type Proc = { pid: number; env: Record<string, string | undefined>; kill(pid: number, signal: number): void; getBuiltinModule?(id: "node:fs"): Fs };
const proc = (globalThis as unknown as { process: Proc }).process;

const VITE_CACHE = "node_modules/.vite";

const running = (pid: number) => {
  try {
    proc.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === "EPERM";
  }
};

/**
 * Each dev server prebundles its dependencies into a cache of its own. Several servers run on this
 * folder side by side (one per working session), and with one shared cache a rebuild by any of them
 * (after an install, say) replaced files the others' open pages still asked for: "Failed to fetch
 * dynamically imported module". Caches of servers no longer running are cleared as a new one starts.
 * Builds and tests keep Vite's usual cache.
 */
function devCacheDir(command: string): string | undefined {
  if (command !== "serve" || proc.env.VITEST) return undefined;
  const fs = proc.getBuiltinModule?.("node:fs");
  try {
    for (const d of fs?.readdirSync(VITE_CACHE) ?? []) {
      const m = /^dev-(\d+)$/.exec(d);
      if (m && Number(m[1]) !== proc.pid && !running(Number(m[1]))) fs!.rmSync(`${VITE_CACHE}/${d}`, { recursive: true, force: true });
    }
  } catch {
    /* no cache yet */
  }
  return `${VITE_CACHE}/dev-${proc.pid}`;
}

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // The SDK is linked from ../bazaar-sdk, which brings its own viem: keep one copy in the bundle.
  resolve: { dedupe: ["viem", "react", "react-dom"] },
  // Relative asset paths, so the build runs from any folder of any static host.
  base: "./",
  cacheDir: devCacheDir(command),
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 4000 },
  server: { port: 5173 },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
}));
