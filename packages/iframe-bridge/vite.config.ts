import { defineConfig } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dts from "vite-plugin-dts";
import type { Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rootPkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
);

const pkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  description: rootPkg.description,
  keywords: rootPkg.keywords,
  type: "module",
  main: "./iframe-bridge.cjs.js",
  module: "./iframe-bridge.es.js",
  types: "./index.d.ts",
  exports: {
    ".": {
      import: "./iframe-bridge.es.js",
      require: "./iframe-bridge.cjs.js",
      types: "./index.d.ts",
    },
  },
  dependencies: rootPkg.dependencies,
  peerDependencies: rootPkg.peerDependencies,
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
];

const globals: Record<string, string> = {
  yjs: "Y",
  "y-protocols": "YProtocols",
  "y-protocols/awareness": "YProtocolsAwareness",
  "lodash-es": "_",
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
      name: "YMxGraphIframeBridge",
      formats: ["es", "cjs", "umd", "iife"],
      fileName: (format) => `iframe-bridge.${format}.js`,
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
