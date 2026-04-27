import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { Binding, LOCAL_ORIGIN } from "y-mxgraph";
import { SIGNALING_SERVERS, DEFAULT_ROOM } from "./config.js";

export interface CollabState {
  provider: WebrtcProvider | null;
  doc: Y.Doc | null;
  binding: Binding | null;
}

export interface CollabCallbacks {
  onPeerCountChange: (count: number) => void;
  onStatusChange: (
    status: "connected" | "disconnected" | "loading",
    text: string,
  ) => void;
}

/**
 * 创建协作连接
 */
export function createCollaboration(
  roomName: string = DEFAULT_ROOM,
  callbacks: CollabCallbacks,
): CollabState {
  const doc = new Y.Doc();
  const provider = new WebrtcProvider(roomName, doc, {
    signaling: SIGNALING_SERVERS,
  });

  // 监听 peer 数量变化
  provider.awareness.on("update", () => {
    const count = provider.awareness.getStates().size;
    callbacks.onPeerCountChange(count);
  });

  // 监听连接状态
  provider.on("status", (event: { connected: boolean }) => {
    if (event.connected) {
      callbacks.onStatusChange("connected", `已连接 (${roomName})`);
    } else {
      callbacks.onStatusChange("loading", "重连中...");
    }
  });

  return { provider, doc, binding: null };
}

/**
 * 绑定 draw.io 文件到 Yjs
 */
export function bindDrawioFile(
  doc: Y.Doc,
  provider: WebrtcProvider,
  onBind: (binding: Binding) => void,
): () => void {
  const undoManager = new Y.UndoManager(doc, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
  });

  const tryBind = () => {
    const App = (window as any).App;
    if (!App) {
      setTimeout(tryBind, 500);
      return;
    }

    App.main((app: any) => {
      const file = app.currentFile;

      const doBind = (f: any) => {
        const binding = new Binding(f, {
          doc,
          awareness: provider.awareness,
          undoManager,
        });

        // 暴露到 window 便于调试
        Reflect.set(window, "__doc__", doc);
        Reflect.set(window, "__provider__", provider);
        Reflect.set(window, "__binding__", binding);

        onBind(binding);
      };

      if (file) {
        doBind(file);
      } else {
        app.editor.addListener("fileLoaded", () => {
          doBind(app.currentFile);
        });
      }
    });
  };

  // 延迟执行以确保 App 完全初始化
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
