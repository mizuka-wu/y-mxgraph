import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dts from "vite-plugin-dts";
import type { Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pkg = {
  name: "y-mxgraph",
  version: "0.1.0",
  description: "Yjs binding for draw.io (mxGraph) documents",
  type: "module",
  main: "./y-mxgraph.cjs.js",
  module: "./y-mxgraph.es.js",
  browser: "./y-mxgraph.umd.js",
  types: "./index.d.ts",
  exports: {
    ".": {
      import: "./y-mxgraph.es.js",
      require: "./y-mxgraph.cjs.js",
      browser: "./y-mxgraph.umd.js",
      types: "./index.d.ts",
    },
  },
  peerDependencies: {
    "y-protocols": "^1.0.0",
    yjs: "^13.6.0",
  },
  license: "MIT",
};

function emitDistPackageJson(): Plugin {
  return {
    name: "emit-dist-package-json",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "package.json",
        source: JSON.stringify(pkg, null, 2),
      });
    },
  };
}

const external = [
  "yjs",
  "y-protocols",
  "y-protocols/awareness",
  "lodash-es",
  "xml-js",
  "colord",
];

const globals: Record<string, string> = {
  yjs: "Y",
  "y-protocols": "YProtocols",
  "y-protocols/awareness": "YProtocolsAwareness",
  "lodash-es": "_",
  "xml-js": "xmljs",
  colord: "colord",
};

export default defineConfig({
  plugins: [
    dts({
      include: ["src"],
      outDir: "dist",
      insertTypesEntry: true,
    }),
    emitDistPackageJson(),
  ],
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "YMXGraph",
      formats: ["es", "cjs", "umd", "iife"],
      fileName: (format) => `y-mxgraph.${format}.js`,
    },
    rollupOptions: {
      external,
      output: {
        globals,
      },
    },
    sourcemap: true,
    minify: false,
    outDir: "dist",
    emptyOutDir: true,
  },
});
