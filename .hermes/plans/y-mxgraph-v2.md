# y-mxgraph v2 计划

## 目标

将 y-mxgraph 从 v1（yjs + Y.Map/Y.Array 手动管理顺序）升级为 v2（@y/y + Y.XmlFragment 原生表示 XML 结构），并提供 v1→v2 数据迁移工具。

## 核心变更

### 1. 依赖升级：yjs → @y/y

| 项目 | v1 | v2 |
|------|----|----|
| 包名 | `yjs` ^13.6 | `@y/y` ^14.0 |
| import | `import * as Y from 'yjs'` | `import * as Y from '@y/y'` |
| peerDep | `yjs` ^13.6 + `y-protocols` ^1.0 | `@y/y` ^14.0（`y-protocols` 已合并） |

**@y/y v14 Breaking Changes**:
- 包名从 `yjs` 改为 `@y/y`
- `Y.XmlFragment` 成为一等类型，API 更丰富（insert/delete/get/push/observeDeep）
- `Y.Array` 不再支持 `move` 操作（不影响我们）
- `y-protocols` 合并进 `@y/y`
- 底层二进制格式向前兼容（v14 可读 v13 数据，反之不行）

### 2. 数据结构重构：Y.Map → Y.XmlFragment

**v1 结构**（手动管理顺序）：
```
Y.Doc
  └─ mxfile (Y.Map)
       ├─ pages: "1"
       ├─ diagram (Y.Map<Y.Map>)      ← key-value 存储
       │    └─ <id> → Y.Map
       │         └─ mxGraphModel (Y.Map)
       │              ├─ mxCell (Y.Map<Y.XmlElement>)    ← cell 数据
       │              ├─ mxCellOrder (Y.Array<string>)   ← 手动维护顺序
       │              └─ background (optional)
       └─ diagramOrder (Y.Array<string>) ← 手动维护顺序
```

**v2 结构**（XmlFragment 隐式顺序）：
```
Y.Doc
  └─ mxfile (Y.XmlElement, nodeName="mxfile")
       ├─ attr: pages="1"
       ├─ children: [diagram1, diagram2, ...]  ← 顺序即 order
       │    └─ Y.XmlElement(nodeName="diagram")
       │         ├─ attr: name, id
       │         └─ children: [mxGraphModel]
       │              └─ Y.XmlElement(nodeName="mxGraphModel")
       │                   └─ children: [cell0, cell1, cell2, ...]  ← 顺序即 order
       │                        └─ Y.XmlElement(nodeName="mxCell")
       │                             ├─ attr: id, parent, vertex, edge, value, ...
       │                             └─ children: [mxGeometry, ...]
       └─ (无需 diagramOrder — children 顺序即 diagram 顺序)
```

**关键简化**：
- 移除 `mxCellOrder`（Y.Array）— cell 顺序由 XmlFragment children 隐式维护
- 移除 `diagramOrder`（Y.Array）— diagram 顺序由 mxfile children 隐式维护
- 移除 `mxCell`（Y.Map）— cell 数据直接用 XmlElement attributes
- 移除 `mxGraphModel`（Y.Map）— 结构直接用 XmlElement nesting
- `cell 0/1 保护` 仍然需要（draw.io 语义约束），但不再需要 `ensureBasicCell` 中的 order 修复

### 3. 迁移工具

提供 `migrateV1ToV2(v1Doc): Y.Doc` 函数：
- 读取 v1 格式的 Y.Doc（Y.Map + Y.Array 结构）
- 转换为 v2 格式的 Y.Doc（Y.XmlFragment 结构）
- 输出的 v2 Y.Doc 可直接被 v2 Binding 使用

同时提供 `migrateV2ToV1(v2Doc): Y.Doc` 反向迁移，确保可回退。

## 实施阶段

### Phase 1: 依赖升级 [预计 0.5 天]

- [ ] 替换 `package.json` 中 `yjs` → `@y/y`
- [ ] 更新所有 `import * as Y from 'yjs'` → `import * from '@y/y'`
- [ ] 移除 `y-protocols` 依赖（已合并）
- [ ] 更新 `iframe-bridge` 包的依赖
- [ ] 确保 `pnpm install` + `pnpm typecheck` 通过

**文件清单**：
```
packages/y-mxgraph/package.json
packages/iframe-bridge/package.json
apps/demo/package.json
apps/websocket-demo/package.json
所有 src/*.ts 中的 import 语句
```

### Phase 2: 新数据结构模型 [预计 2 天]

- [ ] 创建 `src/models/v2/` 目录
- [ ] 实现 `mxfile.ts` — XmlFragment 根节点，children 即 diagram 列表
- [ ] 实现 `diagram.ts` — XmlElement(nodeName="diagram")，attributes 即 name/id，children 即 mxGraphModel
- [ ] 实现 `mxGraphModel.ts` — XmlElement(nodeName="mxGraphModel")，children 即 cell 列表
- [ ] 实现 `mxCell.ts` — XmlElement(nodeName="mxCell")，attributes 即 id/parent/value 等
- [ ] 实现 `xml2ydoc.ts` — XML → v2 Y.Doc 转换
- [ ] 实现 `ydoc2xml.ts` — v2 Y.Doc → XML 序列化

**关键设计**：
```ts
// v2 模型 — 纯 XmlFragment，无额外 Y.Map/Y.Array
export function parseMxFile(xml: string, doc: Y.Doc): Y.XmlElement {
  const mxfile = doc.getXmlFragment('mxfile');
  // 直接将 XML children 插入 XmlFragment
  // 顺序由插入顺序决定，无需额外 order 数组
}

export function serializeMxFile(fragment: Y.XmlFragment): string {
  // 直接从 XmlFragment 序列化为 XML
  // children 顺序即 diagram 顺序
}
```

### Phase 3: Binding 适配 [预计 2 天]

- [ ] 修改 `Binding` 类使用 v2 模型
- [ ] 重写 `docObserver` — 监听 XmlFragment 变更而非 Y.Map
- [ ] 重写 `applyFilePatch` — 适配 XmlFragment 操作
- [ ] 重写 `generatePatch` — 基于 XmlFragment diff
- [ ] 简化 `ensureBasicCell` — 只需检查 cell 0/1 存在性，不再需要 order 修复
- [ ] 移除 `validateDocIntegrity` 中的 order 一致性检查（不再需要）
- [ ] 保留 `INTEGRITY_ORIGIN` 机制（未来扩展用）
- [ ] 更新 `forceSync` — 适配新的同步逻辑

**核心变更**：
```ts
// v1: 监听 Y.Map 变更
doc.getMap('mxfile').observeDeep(...)

// v2: 监听 XmlFragment 变更
doc.getXmlFragment('mxfile').observeDeep(...)
```

### Phase 4: iframe-bridge 适配 [预计 1 天]

- [ ] 更新 `iframe-bridge` 依赖 `@y/y`
- [ ] 确保 postMessage 同步的 update 格式兼容（v14 向前兼容 v13）
- [ ] 测试 iframe 场景下的协作

### Phase 5: 迁移工具 [预计 1 天]

- [ ] 实现 `migrateV1ToV2(v1Doc: Y.Doc): Y.Doc`
  - 读取 v1 的 `doc.getMap('mxfile')`
  - 遍历 diagram map 和 cell map
  - 创建 v2 的 XmlFragment 结构
  - 输出新的 Y.Doc
- [ ] 实现 `migrateV2ToV1(v2Doc: Y.Doc): Y.Doc`（反向迁移）
- [ ] 导出为独立工具函数
- [ ] 添加单元测试

**迁移工具 API**：
```ts
import { migrateV1ToV2, migrateV2ToV1 } from 'y-mxgraph/migrate';

// v1 → v2
const v2Doc = migrateV1ToV2(v1Doc);

// v2 → v1（可回退）
const v1Doc = migrateV2ToV1(v2Doc);
```

### Phase 6: 测试与文档 [预计 1 天]

- [ ] 更新所有单元测试使用 v2 模型
- [ ] 更新 E2E 测试
- [ ] 更新 AGENTS.md
- [ ] 更新 VitePress 文档
- [ ] 更新 demo app
- [ ] 确保 `pnpm test` 全部通过
- [ ] 确保 `pnpm typecheck` 0 错误

### Phase 7: Demo 更新 [预计 0.5 天]

- [ ] 更新 demo 使用 v2 Binding
- [ ] 更新调试按钮适配新结构
- [ ] 测试完整协作流程

## 风险与注意事项

1. **二进制兼容性**：@y/y v14 可读 v13 数据，但 v13 不能读 v14 数据（如果使用了 move）。我们不使用 move，所以实际是双向兼容的
2. **y-webrtc / y-websocket 兼容性**：需要确认这些 provider 是否支持 @y/y v14
3. **draw.io 集成**：draw.io 内部使用 mxGraphModel，XmlFragment 结构需要确保 `file.ui.setFileData(xml)` 仍然正常工作
4. **性能**：XmlFragment 的 observeDeep 可能比 Y.Map 的 observeDeep 触发更频繁（因为 XML 结构更深），需要关注性能

## 时间估算

| 阶段 | 预计时间 |
|------|----------|
| Phase 1: 依赖升级 | 0.5 天 |
| Phase 2: 新数据结构 | 2 天 |
| Phase 3: Binding 适配 | 2 天 |
| Phase 4: iframe-bridge | 1 天 |
| Phase 5: 迁移工具 | 1 天 |
| Phase 6: 测试文档 | 1 天 |
| Phase 7: Demo | 0.5 天 |
| **总计** | **~8 天** |

## 验收标准

1. `pnpm typecheck` 0 错误
2. `pnpm test` 全部通过
3. Demo 可正常协作（WebRTC + WebSocket）
4. iframe-bridge 场景正常
5. `migrateV1ToV2` 可正确转换 v1 数据
6. 文档更新完成
