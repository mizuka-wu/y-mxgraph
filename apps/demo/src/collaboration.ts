import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { type Awareness } from "y-protocols/awareness";
import { Binding, LOCAL_ORIGIN, doc2xml } from "y-mxgraph";
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

export function createCollaboration(
  roomName: string = DEFAULT_ROOM,
  callbacks: CollabCallbacks,
): CollabState {
  const doc = new Y.Doc();
  const provider = new WebrtcProvider(roomName, doc, {
    signaling: SIGNALING_SERVERS,
  });

  provider.awareness.on("update", () => {
    const count = provider.awareness.getStates().size;
    callbacks.onPeerCountChange(count);
  });

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

export function bindDrawioFile(
  doc: Y.Doc,
  awareness: Awareness,
  provider: WebrtcProvider | null,
  onBind: (binding: Binding) => void,
): () => void {
  const undoManager = new Y.UndoManager(doc, {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
  });

  let bindingCreated = false;
  let isMounted = true;

  /**
   * draw.io 的 file.patch() 只更新内部数据结构，不触发 UI 重新渲染。
   * 因此需要在创建 Binding 前，手动把 Y.Doc 数据转成 XML 并设置到 file，
   * 确保 draw.io 用正确的数据初始化。
   *
   * 这是当前 draw.io API 的限制，ws-demo 也采用相同方案。
   */
  const doBind = (app: any, file: any) => {
    if (bindingCreated) return;
    bindingCreated = true;

    const mxfileMap = doc.getMap("mxfile");
    const diagramMap = mxfileMap.get("diagram") as any;
    const docHasData = diagramMap && diagramMap.size > 0;

    // 优先使用 Y.Doc 中的远端数据，确保多端数据一致
    if (docHasData) {
      const xml = doc2xml(doc);
      if (xml && xml.includes("<diagram")) {
        file.ui.setFileData(xml);
        file.setData(xml);
      } else {
        const template = Binding.generateFileTemplate("diagram-0");
        file.ui.setFileData(template);
        file.setData(template);
      }
    } else {
      if (!file.data) {
        const template = Binding.generateFileTemplate("diagram-0");
        file.ui.setFileData(template);
        file.setData(template);
      }
    }

    const binding = new Binding(file, {
      doc,
      awareness,
      undoManager,
    });

    app.refresh();
    window.dispatchEvent(new Event("resize"));

    Reflect.set(window, "__doc__", doc);
    Reflect.set(window, "__binding__", binding);

    onBind(binding);
  };

  const tryBind = () => {
    if (!isMounted || bindingCreated) return;

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

        if (file) {
          doBind(app, file);
        } else {
          app.editor.addListener("fileLoaded", () => {
            doBind(app, app.currentFile);
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

  if (!provider) {
    setTimeout(tryBind, 800);
    return () => { isMounted = false; };
  }

  const mxfileKey = "mxfile";
  const mxfileMap = doc.getMap(mxfileKey);
  const diagramMap = mxfileMap.get("diagram") as any;
  const hasData = diagramMap && diagramMap.size > 0;

  // 策略：优先使用 Y.Doc 中的远端数据，确保多端数据一致
  if (hasData) {
    setTimeout(tryBind, 300);
  } else {
    const peerCount = provider.awareness.getStates().size;
    if (peerCount <= 1) {
      // 单人模式，直接绑定，不需要等待同步
      setTimeout(tryBind, 300);
    } else {
      // 有其他 peer，等待远端数据同步
      let bound = false;
      const onDocUpdate = () => {
        const dm = mxfileMap.get("diagram") as any;
        if (!bound && dm && dm.size > 0) {
          bound = true;
          doc.off("update", onDocUpdate);
          tryBind();
        }
      };
      doc.on("update", onDocUpdate);
      setTimeout(() => {
        if (!bound) {
          bound = true;
          doc.off("update", onDocUpdate);
          tryBind();
        }
      }, 500);
    }
  }

  return () => { isMounted = false; };
}

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

  delete (window as any).__doc__;
  delete (window as any).__provider__;
  delete (window as any).__binding__;
}
