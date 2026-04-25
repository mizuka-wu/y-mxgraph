import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { bindDrawioFile, doc2xml, LOCAL_ORIGIN } from "y-mxgraph";

const DEMO_FILE = `<mxfile pages="1">
  <diagram name="Page-1" id="DEMOabHTdChjKBf1yHdD">
    <mxGraphModel dx="506" dy="689" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

const DRAWIO_VERSIONS: Record<string, string> = {
  "24.7.17": "https://cdn.jsdelivr.net/npm/drawio@24.7.17/src/main/webapp/js/viewer-static.min.js",
  "24.6.4":  "https://cdn.jsdelivr.net/npm/drawio@24.6.4/src/main/webapp/js/viewer-static.min.js",
  "23.1.5":  "https://cdn.jsdelivr.net/npm/drawio@23.1.5/src/main/webapp/js/viewer-static.min.js",
  "22.1.2":  "https://cdn.jsdelivr.net/npm/drawio@22.1.2/src/main/webapp/js/viewer-static.min.js",
};

const DRAWIO_APP_URLS: Record<string, string> = {
  "24.7.17": "https://cdn.jsdelivr.net/npm/drawio@24.7.17/src/main/webapp/index.html",
  "24.6.4":  "https://cdn.jsdelivr.net/npm/drawio@24.6.4/src/main/webapp/index.html",
  "23.1.5":  "https://cdn.jsdelivr.net/npm/drawio@23.1.5/src/main/webapp/index.html",
  "22.1.2":  "https://cdn.jsdelivr.net/npm/drawio@22.1.2/src/main/webapp/index.html",
};

const versionSelect = document.getElementById("version-select") as HTMLSelectElement;
const customUrlGroup = document.getElementById("custom-url-group") as HTMLDivElement;
const customUrlInput = document.getElementById("custom-url-input") as HTMLInputElement;
const loadBtn = document.getElementById("load-btn") as HTMLButtonElement;
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const disconnectBtn = document.getElementById("disconnect-btn") as HTMLButtonElement;
const roomInput = document.getElementById("room-input") as HTMLInputElement;
const loadingOverlay = document.getElementById("loading-overlay") as HTMLDivElement;
const loadingText = loadingOverlay.querySelector("p") as HTMLParagraphElement;
const drawioFrame = document.getElementById("drawio-frame") as HTMLIFrameElement;

const drawioStatusEl = document.getElementById("drawio-status") as HTMLSpanElement;
const drawioDot = document.getElementById("drawio-dot") as HTMLSpanElement;
const collabStatusEl = document.getElementById("collab-status") as HTMLSpanElement;
const collabDot = document.getElementById("collab-dot") as HTMLSpanElement;
const peerCountEl = document.getElementById("peer-count") as HTMLSpanElement;
const peerNumEl = document.getElementById("peer-num") as HTMLSpanElement;

let currentProvider: WebrtcProvider | null = null;
let currentDoc: Y.Doc | null = null;
let drawioLoaded = false;

versionSelect.addEventListener("change", () => {
  const isCustom = versionSelect.value === "custom";
  customUrlGroup.style.display = isCustom ? "flex" : "none";
});

function setDrawioStatus(status: "loading" | "ready" | "error", text: string) {
  drawioStatusEl.textContent = text;
  drawioDot.className = "status-dot";
  if (status === "ready") drawioDot.classList.add("connected");
  else if (status === "loading") drawioDot.classList.add("loading");
}

function setCollabStatus(status: "connected" | "disconnected" | "loading", text: string) {
  collabStatusEl.textContent = text;
  collabDot.className = "status-dot";
  if (status === "connected") collabDot.classList.add("connected");
  else if (status === "loading") collabDot.classList.add("loading");
}

function getDrawioUrl(): string {
  const version = versionSelect.value;
  if (version === "custom") {
    return customUrlInput.value.trim();
  }
  return DRAWIO_APP_URLS[version] || DRAWIO_APP_URLS["24.7.17"];
}

function setupHashAndLoadFrame() {
  const url = getDrawioUrl();
  if (!url) {
    alert("请输入有效的 draw.io URL");
    return;
  }

  drawioLoaded = false;
  connectBtn.disabled = true;
  loadingOverlay.style.display = "flex";
  drawioFrame.style.display = "none";
  loadingText.textContent = `正在加载 draw.io...`;
  setDrawioStatus("loading", "加载中...");

  const fileHash = "#R" + encodeURIComponent(DEMO_FILE);
  const frameUrl = url.includes("?")
    ? url + "&" + fileHash
    : url + fileHash;

  drawioFrame.onload = () => {
    setTimeout(() => {
      drawioLoaded = true;
      loadingOverlay.style.display = "none";
      drawioFrame.style.display = "block";
      connectBtn.disabled = false;
      setDrawioStatus("ready", `已加载 (${versionSelect.value === "custom" ? "自定义" : "v" + versionSelect.value})`);
    }, 1500);
  };

  drawioFrame.src = frameUrl;
}

loadBtn.addEventListener("click", setupHashAndLoadFrame);

function disconnectCollab() {
  if (currentProvider) {
    currentProvider.disconnect();
    currentProvider.destroy();
    currentProvider = null;
  }
  if (currentDoc) {
    currentDoc.destroy();
    currentDoc = null;
  }
  connectBtn.style.display = "inline-block";
  disconnectBtn.style.display = "none";
  peerCountEl.style.display = "none";
  setCollabStatus("disconnected", "未连接");
}

connectBtn.addEventListener("click", async () => {
  if (!drawioLoaded) return;

  const roomName = roomInput.value.trim() || "y-mxgraph-demo";

  setCollabStatus("loading", "连接中...");
  connectBtn.disabled = true;

  const doc = new Y.Doc();
  const provider = new WebrtcProvider(roomName, doc, {
    signaling: ["wss://signaling.yjs.dev", "wss://y-webrtc-signaling-eu.herokuapp.com"],
  });

  currentDoc = doc;
  currentProvider = provider;

  const frameWindow = drawioFrame.contentWindow as any;
  if (!frameWindow) {
    setCollabStatus("disconnected", "无法访问 draw.io 框架");
    connectBtn.disabled = false;
    return;
  }

  provider.awareness.on("update", () => {
    const count = provider.awareness.getStates().size;
    peerNumEl.textContent = String(count);
    peerCountEl.style.display = "inline";
  });

  provider.on("status", (event: { connected: boolean }) => {
    if (event.connected) {
      setCollabStatus("connected", `已连接 (${roomName})`);
    } else {
      setCollabStatus("loading", "重连中...");
    }
  });

  const tryBind = () => {
    try {
      const App = frameWindow.App;
      if (!App) {
        setTimeout(tryBind, 500);
        return;
      }

      App.main((app: any) => {
        const file = app.currentFile;

        const undoManager = new Y.UndoManager(doc, {
          trackedOrigins: new Set([LOCAL_ORIGIN]),
        });

        const doBind = (f: any) => {
          bindDrawioFile(f, {
            doc,
            awareness: provider.awareness,
            undoManager,
          });

          Reflect.set(window, "__doc__", doc);
          Reflect.set(window, "__provider__", provider);
          console.log("[y-mxgraph] 绑定完成，room:", roomName);
        };

        if (file) {
          doBind(file);
        } else {
          app.editor.addListener("fileLoaded", () => {
            doBind(app.currentFile);
          });
        }
      });

      connectBtn.style.display = "none";
      disconnectBtn.style.display = "inline-block";
      connectBtn.disabled = false;
    } catch (e) {
      console.error("[y-mxgraph] 绑定失败:", e);
      setCollabStatus("disconnected", "绑定失败");
      connectBtn.disabled = false;
    }
  };

  setTimeout(tryBind, 800);
});

disconnectBtn.addEventListener("click", disconnectCollab);

const savedRoom = new URLSearchParams(location.search).get("room");
if (savedRoom) {
  roomInput.value = savedRoom;
}

const savedVersion = new URLSearchParams(location.search).get("version");
if (savedVersion && DRAWIO_APP_URLS[savedVersion]) {
  versionSelect.value = savedVersion;
}
