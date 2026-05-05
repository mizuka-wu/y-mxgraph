import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { type Awareness } from "y-protocols/awareness";
import { Binding, LOCAL_ORIGIN, doc2xml } from "y-mxgraph";
import { WS_URL, DEFAULT_ROOM } from "./config.js";

export interface CollabState {
  provider: WebsocketProvider | null;
  doc: Y.Doc | null;
  binding: Binding | null;
}

export interface CollabCallbacks {
  onPeerCountChange: (count: number) => void;
  onStatusChange: (
    status: "connected" | "disconnected" | "loading",
    text: string,
  ) => void;
  connectedText?: (room: string) => string;
  reconnectingText?: string;
}

/**
 * 创建协作连接（使用 y-websocket）
 */
export function createCollaboration(
  roomName: string = DEFAULT_ROOM,
  callbacks: CollabCallbacks,
): CollabState {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(WS_URL, roomName, doc);

  // 监听 peer 数量变化
  provider.awareness.on("update", () => {
    const count = provider.awareness.getStates().size;
    callbacks.onPeerCountChange(count);
  });

  // 监听连接状态
  // WebsocketProvider 的 status 事件格式为 { status: "connecting" | "connected" | "disconnected" }
  provider.on("status", (event: { status: string }) => {
    if (event.status === "connected") {
      const text = callbacks.connectedText
        ? callbacks.connectedText(roomName)
        : `Connected (${roomName})`;
      callbacks.onStatusChange("connected", text);
    } else {
      callbacks.onStatusChange(
        "loading",
        callbacks.reconnectingText ?? "Reconnecting...",
      );
    }
  });

  return { provider, doc, binding: null };
}

/**
 * 绑定 draw.io 文件到 Yjs
 *
 * 流程：
 * 1. 等待 draw.io App 就绪 + file 已加载
 * 2. 等待 WebsocketProvider 初始同步完成（synced）
 * 3. 两者都就绪后创建 Binding（由 Binding 内部处理数据同步）
 */
export function bindDrawioFile(
  provider: WebsocketProvider,
  doc: Y.Doc,
  awareness: Awareness,
  onBind: (binding: Binding) => void,
): () => void {
  const undoManager = new Y.UndoManager(doc, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
  });

  // 两个就绪条件
  let appFile: { app: any; file: any } | null = null;
  let synced = provider.synced;

  const tryFinalize = () => {
    if (!appFile || !synced) return;

    const { app, file } = appFile;
    const mxfileMap = doc.getMap("mxfile");
    const diagramMap = mxfileMap.get("diagram") as any;
    const diagramOrder = mxfileMap.get("diagramOrder") as any;

    // 检查是否真的有 diagram 数据
    const docHasData = diagramMap && diagramMap.size > 0;

    // 先用服务器数据替换本地文件内容,确保页面 ID 一致
    if (docHasData) {
      const xml = doc2xml(doc);
      if (xml && xml.includes("<diagram")) {
        file.ui.setFileData(xml);
        file.setData(xml);
      } else {
        const template = Binding.generateFileTemplate();
        file.ui.setFileData(template);
        file.setData(template);
      }
    } else {
      const template = Binding.generateFileTemplate();
      file.ui.setFileData(template);
      file.setData(template);
    }

    // 再创建 Binding
    const binding = new Binding(file, {
      doc,
      awareness,
      undoManager,
    });

    // 暴露到 window 便于调试
    Reflect.set(window, "__doc__", doc);
    Reflect.set(window, "__binding__", binding);

    onBind(binding);
  };

  // ── 条件 1：等待 provider sync ──
  if (!synced) {
    const onSync = (isSynced: boolean) => {
      if (isSynced) {
        synced = true;
        provider.off("sync", onSync);
        tryFinalize();
      }
    };
    provider.on("sync", onSync);
  }

  // ── 条件 2：等待 draw.io App + file ──
  const tryBind = () => {
    const App = (window as any).App;
    if (!App) {
      setTimeout(tryBind, 500);
      return;
    }

    App.main(
      (ui: any) => {
        ui.refresh();
        window.dispatchEvent(new Event("resize"));

        const app = ui;
        const file = app.currentFile;

        const onFileReady = (f: any) => {
          appFile = { app, file: f };
          tryFinalize();
        };

        if (file) {
          onFileReady(file);
        } else {
          app.editor.addListener("fileLoaded", () => {
            onFileReady(app.currentFile);
          });
        }
      },
      () => {
        const Editor = (window as any).Editor;
        const container = document.getElementById("drawio-container")!;
        if (!container.classList.contains("geEditor")) {
          container.classList.add("geEditor");
        }
        const editor = new Editor(false, null, null, null, true);
        return new App(editor, container);
      },
    );
  };

  const timeoutId = setTimeout(tryBind, 800);

  return () => clearTimeout(timeoutId);
}

/**
 * 断开协作连接
 */
export function disconnectCollaboration(state: CollabState): void {
  if (state.binding) {
    state.binding.destroy(true);
    state.binding = null;
  }
  if (state.provider) {
    state.provider.disconnect();
    state.provider.destroy();
    state.provider = null;
  }
  if (state.doc) {
    state.doc.destroy();
    state.doc = null;
  }

  // 清理 window 上的调试对象
  delete (window as any).__doc__;
  delete (window as any).__provider__;
  delete (window as any).__binding__;
}
