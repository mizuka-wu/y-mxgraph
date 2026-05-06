import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { type Awareness } from "y-protocols/awareness";
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
  connectedText?: (room: string) => string;
  reconnectingText?: string;
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
 */
export function bindDrawioFile(
  doc: Y.Doc,
  awareness: Awareness,
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

    const doBind = (app: any, file: any) => {
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

    // 使用 App.main 双回调模式
    App.main(
      (ui: any) => {
        // 强制重新布局（容器尺寸可能在构建时不正确）
        ui.refresh();
        window.dispatchEvent(new Event("resize"));

        const app = ui;
        const file = app.currentFile;

        if (file) {
          doBind(app, file);
        } else {
          app.editor.addListener("fileLoaded", () => {
            doBind(app, app.currentFile);
          });
        }
      },
      () => {
        // 自定义 UI 创建函数
        const Editor = (window as any).Editor;
        const container = document.getElementById("drawio-container")!;

        // draw.io EditorUi 需要容器带 geEditor class 才能触发绝对定位布局
        if (!container.classList.contains("geEditor")) {
          container.classList.add("geEditor");
        }

        const editor = new Editor(false, null, null, null, true);
        return new App(editor, container);
      },
    );
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
