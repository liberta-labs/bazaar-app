import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // The SDK is linked from ../bazaar-sdk, which brings its own viem: keep one copy in the bundle.
  resolve: { dedupe: ["viem", "react", "react-dom"] },
  // Relative asset paths, so the build runs from any folder of any static host.
  base: "./",
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 4000 },
  server: { port: 5173 },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
