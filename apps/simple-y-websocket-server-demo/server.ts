import http from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as Y from "yjs";
import { WebSocketServer } from "ws";

// y-websocket/bin/utils is CJS, use createRequire for ESM compatibility
const require = createRequire(import.meta.url);
const { setupWSConnection, setPersistence } =
  require("y-websocket/bin/utils") as {
    setupWSConnection: (
      conn: import("ws").WebSocket,
      req: http.IncomingMessage,
      options?: { docName?: string; gc?: boolean },
    ) => void;
    setPersistence: (persistence: {
      bindState: (docName: string, ydoc: Y.Doc) => Promise<void>;
      writeState: (docName: string, ydoc: Y.Doc) => Promise<void>;
    }) => void;
  };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.join(__dirname, "yjs-docs");
const PORT = Number(process.env.PORT) || 1234;
const HOST = process.env.HOST || "localhost";

// Ensure storage directory exists
if (!existsSync(STORAGE_DIR)) {
  mkdirSync(STORAGE_DIR, { recursive: true });
}

// Debounce helper for persistence writes
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
function debouncedSave(docName: string, ydoc: Y.Doc) {
  const existing = debounceTimers.get(docName);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    docName,
    setTimeout(async () => {
      debounceTimers.delete(docName);
      const filePath = path.join(
        STORAGE_DIR,
        `${encodeURIComponent(docName)}.yjs`,
      );
      const state = Y.encodeStateAsUpdate(ydoc);
      await fs.writeFile(filePath, state);
    }, 500),
  );
}

// Configure file system persistence
setPersistence({
  bindState: async (docName: string, ydoc: Y.Doc) => {
    const filePath = path.join(
      STORAGE_DIR,
      `${encodeURIComponent(docName)}.yjs`,
    );

    try {
      const data = await fs.readFile(filePath);
      Y.applyUpdate(ydoc, new Uint8Array(data));
      console.log(`[persistence] Loaded document: ${docName}`);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        console.log(`[persistence] New document created: ${docName}`);
      } else {
        throw err;
      }
    }

    // Subscribe to updates for incremental persistence (debounced)
    ydoc.on("update", () => {
      debouncedSave(docName, ydoc);
    });
  },

  writeState: async (docName: string, ydoc: Y.Doc) => {
    // Cancel any pending debounced save
    const existing = debounceTimers.get(docName);
    if (existing) {
      clearTimeout(existing);
      debounceTimers.delete(docName);
    }

    const filePath = path.join(
      STORAGE_DIR,
      `${encodeURIComponent(docName)}.yjs`,
    );
    const state = Y.encodeStateAsUpdate(ydoc);
    await fs.writeFile(filePath, state);
    console.log(`[persistence] Persisted document on close: ${docName}`);
  },
});

// HTTP server (for health check)
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("y-websocket server running\n");
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  setupWSConnection(ws, req, { gc: true });
});

server.listen(PORT, HOST, () => {
  console.log(`[server] y-websocket server running on ws://${HOST}:${PORT}`);
  console.log(`[server] Persistence directory: ${STORAGE_DIR}`);
});
