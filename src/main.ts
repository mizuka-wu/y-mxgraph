import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { bindDrawioFile, doc2xml } from "./yjs";

/**
 * 通过注入的方式拿到实例, 这个之后再考虑什么时候搞进去，3s后开发版是一定加载完成的
 */
setTimeout(() => {
  (window as any).Draw.loadPlugin((app: any) => {
    const file = app.currentFile;
    if (!file) return console.warn("no file");
    const doc = new Y.Doc();
    const roomName = file.getId() || file.draftId || file.created + "";
    const provider = new WebrtcProvider(roomName, doc, {
      signaling: [],
    });
    bindDrawioFile(file, {
      doc,
      awareness: provider.awareness,
    });

    Reflect.set(window, "__doc__", doc);
    Reflect.set(window, "__awareness__", provider.awareness);
    console.log("注入完成 当前room：", roomName, {
      fileId: file.getId(),
      draftId: file.draftId,
      created: file.created + "",
    });

    console.log(doc2xml(doc));
  });
}, 3000);
