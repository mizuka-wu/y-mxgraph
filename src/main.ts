import * as Y from "yjs";
import { WebrtcProvider } from "y-webrtc";
import { bindDrawioFile, xml2doc } from "./yjs";

/**
 * 通过注入的方式拿到实例, 这个之后再考虑什么时候搞进去，3s后开发版是一定加载完成的
 */
setTimeout(() => {
  (window as any).Draw.loadPlugin((app: any) => {
    const file = app.currentFile;
    const doc = new Y.Doc();
    const provider = new WebrtcProvider(file.id, doc, {
      signaling: [],
    });
    bindDrawioFile(file, {
      doc,
      awareness: provider.awareness,
    });
  });
}, 3000);
