import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  server: {
    port: 5173,
  },
  plugins: [],
  resolve: {
    alias: {
      "yjs": path.resolve(__dirname, "node_modules/yjs"),
      "y-protocols": path.resolve(__dirname, "node_modules/y-protocols"),
    },
  },
  optimizeDeps: {
    include: [
      "yjs",
      "y-protocols",
      "y-protocols/awareness",
      "y-webrtc",
    ],
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "index.html",
        iframe: "iframe.html",
      },
    },
  },
  base: process.env.VITE_BASE ?? "/",
});
