import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  server: {
    port: 5173,
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: true,
      },
      workbox: {
        mode: 'production',
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "jsdelivr-drawio",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
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
