# 同步策略

本文档解释 y-mxgraph 与 draw.io 集成时的同步策略，帮助理解为什么需要特定的初始化流程。

## 问题背景

当多个客户端协作编辑同一个 draw.io 文件时，需要确保：

1. **初始数据一致** — 所有客户端使用相同的 diagram id
2. **同步时机正确** — 新客户端加入时，先获取远端数据再创建 Binding
3. **UI 正确渲染** — draw.io 的 UI 需要正确显示同步后的数据

## 为什么需要等待同步

当新客户端加入房间时，Y.Doc 是空的。如果立即创建 Binding：

```typescript
// ❌ 错误做法
const binding = new Binding(file, { doc });
```

会导致以下问题：

1. Binding 检测到 Y.Doc 为空，用本地模板初始化
2. 远端数据到达后，与本地数据冲突
3. 两端数据不一致，出现「孤立 page」

**正确做法**是等待 Y.Doc 收到远端数据后再创建 Binding：

```typescript
const mxfileMap = doc.getMap('mxfile');
const diagramMap = mxfileMap.get('diagram');
const hasData = diagramMap && diagramMap.size > 0;

if (hasData) {
  // 有数据，直接绑定
  setTimeout(tryBind, 300);
} else {
  const peerCount = provider.awareness.getStates().size;
  if (peerCount <= 1) {
    // 单人模式，直接绑定
    setTimeout(tryBind, 300);
  } else {
    // 有其他 peer，等待远端数据同步
    doc.on('update', () => {
      if (diagramMap && diagramMap.size > 0) {
        tryBind();
      }
    });
  }
}
```

## 为什么需要手动同步 doc 到 file

draw.io 的 `file.patch()` 方法只更新内部数据结构，**不触发 UI 重新渲染**。

这意味着：
- 数据已正确同步到 Y.Doc
- 但 draw.io 的 UI 显示的还是旧数据

因此在创建 Binding 前，需要手动把 Y.Doc 数据转成 XML 并设置到 file：

```typescript
import { doc2xml } from 'y-mxgraph';

if (docHasData) {
  const xml = doc2xml(doc);
  file.ui.setFileData(xml);  // 更新 UI 显示
  file.setData(xml);         // 更新数据
}
```

这是 draw.io API 的限制，[ws-demo](https://github.com/mizuka-wu/y-mxgraph/tree/main/apps/simple-y-websocket-server-demo) 也采用相同方案。

## 完整流程

```typescript
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { Binding, doc2xml } from 'y-mxgraph';

const doc = new Y.Doc();
const provider = new WebrtcProvider('my-room', doc);

function bindDrawio() {
  const App = (window as any).App;
  if (!App) {
    setTimeout(bindDrawio, 500);
    return;
  }

  App.main((ui: any) => {
    const file = ui.currentFile;

    // 1. 检查 Y.Doc 是否有数据
    const mxfileMap = doc.getMap('mxfile');
    const diagramMap = mxfileMap.get('diagram');
    const docHasData = diagramMap && diagramMap.size > 0;

    // 2. 手动同步数据到 file
    if (docHasData) {
      file.ui.setFileData(doc2xml(doc));
      file.setData(doc2xml(doc));
    } else if (!file.data) {
      file.data = Binding.generateFileTemplate('diagram-0');
    }

    // 3. 创建 Binding
    const binding = new Binding(file, { doc });

    // 4. 刷新 UI
    ui.refresh();
    window.dispatchEvent(new Event('resize'));
  }, () => {
    // UI 工厂函数
    const Editor = (window as any).Editor;
    const container = document.getElementById('drawio-container')!;
    const editor = new Editor(false, null, null, null, true);
    return new App(editor, container);
  });
}

// 等待同步后绑定
const mxfileMap = doc.getMap('mxfile');
const diagramMap = mxfileMap.get('diagram');
if (diagramMap && diagramMap.size > 0) {
  setTimeout(bindDrawio, 300);
} else {
  doc.on('update', () => {
    const dm = mxfileMap.get('diagram');
    if (dm && dm.size > 0) {
      bindDrawio();
    }
  });
}
```

## 与 ws-demo 的对比

| 特性 | demo (WebRTC) | ws-demo (WebSocket) |
|------|---------------|---------------------|
| 同步策略 | 等待 Y.Doc update 事件 | 等待 provider synced 事件 |
| 数据同步 | 手动 doc2xml + setFileData | 手动 doc2xml + setFileData |
| 超时兜底 | 500ms | 无（WebSocket 可靠） |

两者都采用手动同步方案，因为这是 draw.io API 的限制。

## 常见问题

### 新窗口不显示旧窗口的数据

**原因**：Binding 在 Y.Doc 收到远端数据前就创建了。

**解决**：等待 Y.Doc 有数据后再创建 Binding（参考上面的代码）。

### 数据同步了但 UI 没更新

**原因**：`file.patch()` 不触发 UI 重新渲染。

**解决**：在创建 Binding 前手动调用 `file.ui.setFileData(xml)` 和 `file.setData(xml)`。

### 出现孤立 page

**原因**：本地模板的 diagram id 与远端数据不一致。

**解决**：使用 `Binding.generateFileTemplate(diagramId)` 生成统一的模板。
