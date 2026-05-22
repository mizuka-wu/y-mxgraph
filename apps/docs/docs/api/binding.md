# Binding

`Binding` 类管理 draw.io 文件与 `Y.Doc` 的双向绑定。

## 构造函数

```ts
new Binding(file: any, options: BindDrawioFileOptions)
```

## 参数

### `file`

draw.io 编辑器内部的文件对象，通过 `App.main((app) => app.currentFile)` 获取。

### `options`

```ts
interface BindDrawioFileOptions {
  doc: Y.Doc;                  // 必填，外部传入的 Y.Doc
  awareness?: Awareness;       // 可选，y-protocols awareness（协作光标/选区）
  undoManager?: Y.UndoManager | false; // 可选，传入实例启用撤销/重做；传 false 显式跳过（如 iframe-bridge 场景）
  mouseMoveThrottle?: number;  // 可选，光标移动节流 ms，默认 100
  cursor?:                     // 可选，远端光标渲染配置
    | boolean
    | {
        userNameKey?: string;  // awareness 中用户名字段，默认 'user.name'
        userColorKey?: string; // awareness 中颜色字段，默认 'user.color'
      };
  initialContent?: InitialContentStrategy; // 可选，初始内容策略，默认 'replace'
  applyFileData?: (file, xml) => void;     // 可选，自定义 file 数据应用方式
  disableBeforeUnload?: boolean;           // 可选，禁用 beforeUnload 弹窗，默认 true
  transformPatch?: (patch: FilePatch) => FilePatch | null | undefined; // 可选，转换/过滤本地 patch
}
```

#### `initialContent`

控制绑定时 file 与 Y.Doc 的初始内容对齐策略。默认 `'replace'`。

| 策略 | 行为 |
|------|------|
| `replace` | doc 非空则用 doc 覆盖 file；doc 为空则保留 file 现有数据 |
| `merge-remote` | 按 diagram id 取并集，同 id 冲突时以 doc 为准（远端权威） |
| `merge-client` | 按 diagram id 取并集，同 id 冲突时以 file 为准（本地权威） |

#### `applyFileData`

自定义把 XML 应用到 file 的方式。默认只调用 `file.ui.setFileData(xml)`（刷新 UI / 重建 pages），**不会**调用 `file.setData(xml)`，以避免把 file 标记为「已修改」触发 draw.io 的 "Save diagrams to:" 存储选择对话框。

若业务方确实需要同步 `file.data`（如自定义 CollabFile 或依赖 `file.save()`），可提供自定义实现：

```ts
new Binding(file, {
  doc,
  applyFileData: (f, xml) => {
    f.ui.setFileData(xml);
    f.setData(xml);
  },
});
```

#### `disableBeforeUnload`

是否禁用 draw.io 的 `beforeunload` 弹窗。默认 `true`。

Yjs 接管持久化后，draw.io 的原生保存状态不再有意义。但 draw.io 内部会在特定条件下（如 LocalFile 无 fileHandle、图表非空等）弹出 "All changes will be lost" 或 "Ensure your data has been saved" 提示。

设为 `true`（默认）可彻底禁用这些弹窗，适合纯 Yjs 协作场景。若需要保留原生行为（如使用 File System Access API），设为 `false`。

#### `transformPatch`

可选回调，在本地 patch 同步到 Y.Doc 前进行转换或过滤。适用于外部图片存储等场景。

**签名**: `(patch: FilePatch) => FilePatch | null | undefined`

**返回值**:
- `undefined` 或原始 patch：不过滤，直接同步
- 修改后的 `FilePatch`：使用修改后的 patch 同步
- `null`：跳过本次同步

**示例 — 图片存储优化**:

```ts
import { Binding } from 'y-mxgraph';

// 将 base64 图片提取到 Y.Doc 外部存储，只同步 img:<uuid> 引用
const binding = new Binding(file, {
  doc,
  transformPatch: (patch) => {
    // 检测并移除 patch 中的 base64 图片
    // 异步上传图片到存储
    // 返回包含 img:<uuid> 引用的修改后 patch
    return transformedPatch;
  },
});
```

详见 [IMAGE-STORAGE.md](https://github.com/mizuka-wu/y-mxgraph/blob/main/apps/demo/src/helpers/IMAGE-STORAGE.md) 完整实现。

## 实例属性

### `doc: Y.Doc`

绑定的 Y.Doc 实例，只读。

## 静态方法

### `Binding.generateFileTemplate(diagramId?: string): string`

生成标准化的 mxfile XML 模板，用于确保多端协同的数据起点一致。

**参数**:

- `diagramId` — diagram 的固定 id，默认 `"diagram-0"`

**返回值**: 最小化的 mxfile XML 字符串

**为什么需要这个方法**:

draw.io 新建 diagram 时默认生成随机 id（如 `DEMOabHTdChjKBf1yHdD`）。如果各客户端初始化时的 diagram id 不同，Y.Doc 中的数据与本地 `file.data` 无法对齐，会导致后进房间的客户端出现「孤立 page」，patch diff 也无法正确匹配 diagram/cell id，协同失效。

业务方应在初始化 draw.io 文件时，先用此方法生成统一起点的 XML，再注入到 draw.io 的 `currentFile.data` 中（详见「接入注意事项」）。

**示例**:

```ts
import { Binding } from 'y-mxgraph';

// 使用默认 id "diagram-0"
const template = Binding.generateFileTemplate();

// 或指定固定 id（如与房间/项目绑定）
const template = Binding.generateFileTemplate("room-123-main");
```

## 实例方法

### `destroy(deep?: boolean): void`

销毁绑定，解除所有监听器。

**参数**:

- `deep` - 是否深度清理，默认 `false`
  - `false`: 只解除核心绑定监听器（mxGraphModel change, Y.Doc observeDeep）
  - `true`: 完全清理，包括 Awareness/UndoManager 子系统，恢复原始 undoManager

**使用建议**:

- 页面刷新/关闭时调用 `destroy()` 即可
- 动态切换 draw.io 文件时调用 `destroy(true)` 完全清理

## 示例

### 基础用法

```ts
import * as Y from 'yjs';
import { Binding } from 'y-mxgraph';

const doc = new Y.Doc();

App.main((app) => {
  const binding = new Binding(app.currentFile, { doc });

  // 卸载时清理
  window.addEventListener('beforeunload', () => {
    binding.destroy();
  });
});
```

### 配合 React/Vue 使用

```ts
// React
useEffect(() => {
  const binding = new Binding(file, { doc, awareness });
  // 组件卸载时完全清理
  return () => binding.destroy(true);
}, [file, doc]);

// Vue
const binding = new Binding(file, { doc, awareness });
onUnmounted(() => {
  binding.destroy(true);
});
```

## 关于 UndoManager

`Binding` 不再内部自动创建 `Y.UndoManager`。如需撤销/重做，请在外部创建后传入：

```ts
const undoManager = new Y.UndoManager(doc, {
  trackedOrigins: new Set([LOCAL_ORIGIN]),
});

const binding = new Binding(file, { doc, undoManager });
```

`LOCAL_ORIGIN` 是 `y-mxgraph` 导出的静态标识对象，用于区分本地事务和远端事务。
