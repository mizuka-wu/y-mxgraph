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
const PORT = Number(process.env.PORT) || 2345;
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
    console.log(`[persistence] bindState 被调用: "${docName}"`);

    const filePath = path.join(
      STORAGE_DIR,
      `${encodeURIComponent(docName)}.yjs`,
    );

    // 监听 Yjs 更新事件
    ydoc.on("update", (update: Uint8Array, origin: any) => {
      console.log(
        `[ydoc] "${docName}" 收到 update: ${update.length} bytes, origin: ${origin || "null"}`,
      );
    });

    try {
      const data = await fs.readFile(filePath);
      console.log(
        `[persistence] 从文件加载 "${docName}": ${data.length} bytes`,
      );
      Y.applyUpdate(ydoc, new Uint8Array(data));
      console.log(`[persistence] 成功加载文档: ${docName}`);

      // 打印加载后的文档状态
      const mxfileMap = ydoc.getMap("mxfile");
      console.log(
        `[ydoc] "${docName}" 加载后的 mxfile keys:`,
        Array.from(mxfileMap.keys()),
      );
    } catch (err: any) {
      if (err.code === "ENOENT") {
        console.log(`[persistence] 新文档创建: "${docName}" (文件不存在)`);
      } else {
        console.error(`[persistence] 加载 "${docName}" 失败:`, err.message);
        throw err;
      }
    }

    // Subscribe to updates for incremental persistence (debounced)
    ydoc.on("update", () => {
      debouncedSave(docName, ydoc);
    });
  },

  writeState: async (docName: string, ydoc: Y.Doc) => {
    console.log(`[persistence] writeState 被调用: "${docName}"`);

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
    console.log(
      `[persistence] 文档已持久化: "${docName}" (${state.length} bytes)`,
    );
  },
});

// HTTP server (for health check)
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("y-websocket server running\n");
});

// WebSocket server
// 存储活跃的文档连接统计
const docConnections = new Map<string, number>();

function logConnectionStats() {
  console.log("[stats] 当前活跃连接:");
  for (const [docName, count] of docConnections.entries()) {
    console.log(`  - ${docName}: ${count} 个客户端`);
  }
}

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  // 从 URL 提取房间名
  const url = req.url || "/";
  const roomName = url.slice(1).split("?")[0] || "default";

  console.log(
    `[ws] 新连接: ${req.socket.remoteAddress} -> 房间: "${roomName}"`,
  );
  console.log(`[ws] 请求 URL: ${url}`);

  // 统计连接数
  const currentCount = docConnections.get(roomName) || 0;
  docConnections.set(roomName, currentCount + 1);
  logConnectionStats();

  // 监听消息以诊断数据流
  const originalSend = ws.send.bind(ws);
  ws.send = function (data: string | Buffer | ArrayBuffer, ...args: any[]) {
    const dataLen =
      typeof data === "string"
        ? data.length
        : Buffer.byteLength(data as Uint8Array);
    console.log(`[ws] -> 发送给 "${roomName}": ${dataLen} bytes`);
    if (dataLen < 200) {
      let preview: string;
      if (typeof data === "string") {
        preview = data;
      } else {
        preview = Buffer.from(data as Uint8Array)
          .toString("base64")
          .slice(0, 100);
      }
      console.log(`[ws]    内容预览: ${preview}...`);
    }
    return originalSend(data, ...args);
  };

  ws.on("message", (data: string | Buffer) => {
    const dataLen = typeof data === "string" ? data.length : data.length;
    console.log(`[ws] <- 收到来自 "${roomName}": ${dataLen} bytes`);
    if (dataLen < 200) {
      const preview =
        typeof data === "string" ? data : data.toString("base64").slice(0, 100);
      console.log(`[ws]    内容预览: ${preview}...`);
    }
  });

  ws.on("close", () => {
    console.log(`[ws] 断开连接: "${roomName}"`);
    const count = docConnections.get(roomName) || 0;
    if (count <= 1) {
      docConnections.delete(roomName);
    } else {
      docConnections.set(roomName, count - 1);
    }
    logConnectionStats();
  });

  ws.on("error", (err) => {
    console.error(`[ws] 错误 (房间 "${roomName}"):`, err.message);
  });

  // 关键：传递 docName 参数以启用房间隔离
  setupWSConnection(ws, req, { gc: true, docName: roomName });
});

server.listen(PORT, HOST, () => {
  console.log(`[server] y-websocket server running on ws://${HOST}:${PORT}`);
  console.log(`[server] Persistence directory: ${STORAGE_DIR}`);
});
