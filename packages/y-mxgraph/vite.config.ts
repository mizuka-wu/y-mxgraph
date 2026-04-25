import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dts from "vite-plugin-dts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    dts({
      include: ["src"],
      outDir: "dist",
      insertTypesEntry: true,
    }),
  ],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "YMXGraph",
      formats: ["es", "cjs"],
      fileName: (format) => `y-mxgraph.${format}.js`,
    },
    rollupOptions: {
      external: [
        "yjs",
        "y-protocols",
        "y-protocols/awareness",
        "lodash-es",
        "xml-js",
        "colord",
      ],
      output: {
        globals: {
          yjs: "Y",
          "y-protocols": "YProtocols",
          "y-protocols/awareness": "YProtocolsAwareness",
          "lodash-es": "_",
          "xml-js": "xmljs",
          colord: "colord",
        },
      },
    },
    sourcemap: true,
    minify: false,
    outDir: "dist",
    emptyOutDir: true,
  },
});
