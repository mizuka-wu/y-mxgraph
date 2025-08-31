import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/yjs/index.ts"),
      name: "YMXGraph",
      formats: ["es", "cjs", "umd"],
      fileName: (format) => `y-mxgraph.${format}.js`,
    },
    rollupOptions: {
      // 将外部依赖排除出打包（由使用方提供）
      external: ["lodash-es", "yjs", "y-protocols", "xml-js", "colord", "diff"],
      output: {
        globals: {
          "lodash-es": "_",
          yjs: "Y",
          "y-protocols": "YProtocols",
          "xml-js": "xmljs",
          colord: "colord",
          diff: "Diff",
        },
      },
    },
    sourcemap: true,
    minify: false,
    outDir: "dist",
    emptyOutDir: true,
  },
});
