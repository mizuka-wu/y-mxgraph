import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "index.html",
        iframe: "iframe.html",
      },
    },
    // Production base path when served under the docs site
    // Override with VITE_BASE env var for standalone deploys
  },
  base: process.env.VITE_BASE ?? "/",
});
