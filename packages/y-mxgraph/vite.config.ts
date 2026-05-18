import { defineConfig } from "vite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import dts from "vite-plugin-dts";
import type { Plugin } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 读取根目录 package.json 的版本号
const rootPkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
);

const pkg = {
  name: "y-mxgraph",
  version: rootPkg.version,
  description: "Yjs binding for draw.io (mxGraph) documents",
  keywords: rootPkg.keywords,
  main: "./y-mxgraph.cjs.js",
  module: "./y-mxgraph.es.js",
  types: "./index.d.ts",
  exports: {
    ".": {
      import: "./y-mxgraph.es.js",
      require: "./y-mxgraph.cjs.js",
      types: "./index.d.ts",
    },
    "./iframe-bridge/server": {
      import: "./iframe-bridge/server.es.js",
      require: "./iframe-bridge/server.cjs.js",
      types: "./iframe-bridge/server.d.ts",
    },
    "./iframe-bridge/provider": {
      import: "./iframe-bridge/provider.es.js",
      require: "./iframe-bridge/provider.cjs.js",
      types: "./iframe-bridge/provider.d.ts",
    },
  },
  dependencies: {
    colord: "^2.9.3",
    "xml-js": "^1.6.11",
  },
  peerDependencies: {
    "y-protocols": "^1.0.0",
    yjs: "^13.6.0",
  },
  license: "MIT",
};

function copyRootFiles(...fileNames: string[]): Plugin {
  const rootDir = path.resolve(__dirname, "../..");
  return {
    name: "copy-root-files",
    generateBundle() {
      for (const fileName of fileNames) {
        const filePath = path.join(rootDir, fileName);
        if (fs.existsSync(filePath)) {
          this.emitFile({
            type: "asset",
            fileName,
            source: fs.readFileSync(filePath, "utf-8"),
          });
        }
      }
    },
  };
}

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
  "xml-js",
  "colord",
];

const globals: Record<string, string> = {
  yjs: "Y",
  "y-protocols": "YProtocols",
  "y-protocols/awareness": "YProtocolsAwareness",
  "xml-js": "xmljs",
  colord: "colord",
};

export default defineConfig({
  plugins: [
    dts({
      include: ["src"],
      outDir: "dist",
    }),
    emitDistPackageJson(),
    copyRootFiles("README.md", "README.zh-CN.md"),
  ],
  build: {
    lib: {
      entry: {
        index: path.resolve(__dirname, "src/index.ts"),
        "iframe-bridge/server": path.resolve(
          __dirname,
          "src/iframe-bridge/server.ts",
        ),
        "iframe-bridge/provider": path.resolve(
          __dirname,
          "src/iframe-bridge/provider.ts",
        ),
      },
      name: "YMXGraph",
      formats: ["es", "cjs"],
      fileName: (format, entryName) => {
        if (entryName === "index") {
          return `y-mxgraph.${format}.js`;
        }
        return `${entryName}.${format}.js`;
      },
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
