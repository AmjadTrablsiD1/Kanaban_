import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev: Vite on its own port, proxying /api to a backend started with --port.
// Shipped: no proxy at all -- the Python server serves ui/dist itself, one process, one port.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: { "/api": { target: process.env.VITE_API ?? "http://127.0.0.1:8124" } },
    fs: { allow: [".."] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,       // the lazy 3D chunk carries three.js (loaded only on demand)
  },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
