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

## Binding 如何同步 doc 与 file

draw.io 的 `file.patch()` 只更新内部数据结构，**不触发 UI 重新渲染**；UI 重绘需要 `file.ui.setFileData(xml)`，而 `file.data` 则需要 `file.setData(xml)` 才会同步。

以前版本需要业务在创建 Binding 前手动同步，现在 **Binding 会自动处理**。通过 `initialContent` 选项控制初始化策略，默认 `replace`：

```typescript
// 默认 'replace'：doc 非空时用 doc XML 覆盖 file UI
new Binding(file, { doc });

// 'merge-remote'：按 diagram id 取并集，冲突以 doc 为准
new Binding(file, { doc, initialContent: 'merge-remote' });

// 'merge-client'：按 diagram id 取并集，冲突以 file 为准
new Binding(file, { doc, initialContent: 'merge-client' });
```

若定制 file 子类（如 CollabFile / DriveFile）在 `setData` 上重写了自动保存逻辑，可以提供 `applyFileData` 钩子接管：

```typescript
new Binding(file, {
  doc,
  applyFileData: (f, xml) => {
    // 只走 UI 刷新，跳过可能触发保存的 setData
    f.ui.setFileData(xml);
  },
});
```

## 完整流程

```typescript
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { Binding } from 'y-mxgraph';

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

    // Binding 内部会按 initialContent 策略（默认 'replace'）调用
    // file.ui.setFileData(xml) + file.setData(xml)，业务不需手动处理。
    const binding = new Binding(file, { doc });

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

**解决**：等待 Y.Doc 有数据后再创建 Binding（参考上面的代码）。

### 数据同步了但 UI 没更新

**原因**：`file.patch()` / `file.setData()` 都不触发 UI 重绘，只有 `file.ui.setFileData(xml)` 才能重建 pages 与 mxGraphModel。

**解决**：使用 v0.2 之后的 Binding，它会自动在初始化阶段同时调用 `setFileData` 与 `setData`；若只需刷 UI 不动 `file.data`，可用 `applyFileData` 钩子覆写默认逻辑。

### 出现孤立 page

**原因**：本地模板的 diagram id 与远端数据不一致。

**解决**：使用 `Binding.generateFileTemplate(diagramId)` 生成统一的模板。
