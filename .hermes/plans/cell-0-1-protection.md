# y-mxgraph Cell 0/1 保护修复计划

## 问题描述

单人使用时，转换后的 Y.Doc 中 cell 0（根节点）和 cell 1（默认图层）会被删除，导致：
- 场景 A：cellsOrder 只有 "1"，缺 "0" 和其他 cell
- 场景 B：cellsMap 和 cellsOrder 都没有 "0"、"1"

## 根因分析

### 删除路径（无任何保护）

```
draw.io diffPages() → DIFF_REMOVE ["0","1"] → applyFilePatch() → cellsMap.delete + orderArr.delete
                                    ↓
                            generatePatch() 检测到 → 传播 DIFF_REMOVE
                                    ↓
                            其他客户端/撤销 → 进一步扩散
```

### 具体问题点

| 位置 | 行号 | 问题 |
|------|------|------|
| `patch.ts` `applyFilePatch` | 267-276 | cell DELETE 无保护，直接删除 cellsMap + cellsOrder |
| `patch.ts` `generatePatch` | 620-623 | 检测到 cell 消失后生成 DIFF_REMOVE，传播删除 |
| `binding/index.ts` | 52-54 | draw.io `diffPages()` 黑盒可能产生 cell 0/1 的 DIFF_REMOVE |
| `mxGraphModel.ts` `serialize` | 58-60 | cellsOrder 有 id 但 cellsMap 没有时 crash |
| 全局 | — | 无 `ensureRootCells` 恢复机制 |
| 全局 | — | cellsOrder 和 cellsMap 无一致性校验 |

---

## 修复方案

### Phase 1：防护层（防止删除）

#### 1.1 `patch.ts` — applyFilePatch cell DELETE 保护

**文件**：`src/yjs/binding/patch.ts`
**位置**：第 267-276 行

```typescript
// 在 DIFF_REMOVE 处理前添加过滤
const PROTECTED_CELLS = new Set(["0", "1"]);

if (update.cells[DIFF_REMOVE] && update.cells[DIFF_REMOVE].length) {
  // 过滤掉受保护的 cell
  const safeRemove = update.cells[DIFF_REMOVE].filter(
    (cid) => !PROTECTED_CELLS.has(cid)
  );
  // 过滤掉 cellsMap 中不存在的 id（避免无效操作）
  const validRemove = safeRemove.filter((cid) => cellsMap.has(cid));
  
  if (validRemove.length !== update.cells[DIFF_REMOVE].length) {
    console.warn(
      "[y-mxgraph] blocked removal of protected/invalid cells:",
      update.cells[DIFF_REMOVE].filter(
        (cid) => PROTECTED_CELLS.has(cid) || !cellsMap.has(cid)
      )
    );
  }
  
  if (validRemove.length) {
    const orderIds = orderArr.toArray();
    const removeIndexList = validRemove
      .map((cid) => orderIds.indexOf(cid))
      .filter((i) => i !== -1)
      .sort((a, b) => b - a);
    removeIndexList.forEach((idx) => orderArr.delete(idx, 1));
    validRemove.forEach((cid) => cellsMap.delete(cid));
  }
}
```

#### 1.2 `patch.ts` — generatePatch cell 删除检测保护

**文件**：`src/yjs/binding/patch.ts`
**位置**：第 620-623 行

```typescript
const PROTECTED_CELLS = new Set(["0", "1"]);

// 删除检测时跳过受保护的 cell
const removed = prevCells.filter(
  (cid: string) => !currSet.has(cid) && cid && !PROTECTED_CELLS.has(cid)
);
```

#### 1.3 `patch.ts` — generatePatch cell 插入时确保受保护 cell 存在

**文件**：`src/yjs/binding/patch.ts`
**位置**：在 generatePatch 的 cellsOrder 循环中（约 610 行后）

```typescript
// 在比较 cellsOrder 之前，检查受保护 cell 是否缺失
const currentOrderArr = gm.get(mxCellOrderKey) as Y.Array<string>;
const currentOrder = currentOrderArr.toArray();
const cellsMap = gm.get(mxCellKey) as Y.Map<Y.XmlElement>;

// 如果 cellsOrder 缺少受保护的 cell，先修复
let needsRepair = false;
for (const protectedId of ["0", "1"]) {
  if (!currentOrder.includes(protectedId)) {
    // 检查 cellsMap 中是否存在
    if (cellsMap.has(protectedId)) {
      // 只在 cellsOrder 中补回
      currentOrderArr.insert(protectedId === "0" ? 0 : 1, [protectedId]);
      needsRepair = true;
    }
    // cellsMap 也缺失的情况在 ensureRootCells 中处理
  }
}
if (needsRepair) {
  // 重新读取修复后的 order
  // ... 重新赋值 currCells
}
```

#### 1.4 `binding/index.ts` — diffPages 结果过滤

**文件**：`src/yjs/binding/index.ts`
**位置**：第 52-54 行

```typescript
const patch = file.ui.diffPages(file.shadowPages, file.ui.pages);

// 过滤掉对 cell 0/1 的删除操作
const PROTECTED_CELLS = new Set(["0", "1"]);
if (patch?.u) {
  for (const diagramId of Object.keys(patch.u)) {
    const update = patch.u[diagramId];
    if (update?.cells?.r) {
      update.cells.r = update.cells.r.filter(
        (cid: string) => !PROTECTED_CELLS.has(cid)
      );
    }
  }
}

file.setShadowPages(file.ui.clonePages(file.ui.pages));
applyFilePatch(doc, patch, { origin: LOCAL_ORIGIN });
```

---

### Phase 2：恢复层（检测 + 修复）

#### 2.1 `patch.ts` — 新增 ensureRootCells 函数

**文件**：`src/yjs/binding/patch.ts`
**位置**：在文件顶部（helper 函数区域）

```typescript
const PROTECTED_CELLS = new Set(["0", "1"]);

/**
 * 确保每个 diagram 的 cell 0（根节点）和 cell 1（默认图层）存在。
 * 如果缺失则创建，如果 cellsOrder 缺少则补回。
 */
export function ensureRootCells(doc: Y.Doc): void {
  const mxfile = doc.getMap(mxfileKey) as YMxFile;
  const diagramsMap = mxfile.get(diagramKey) as unknown as Y.Map<YDiagram>;
  const orderArr = mxfile.get(diagramOrderKey) as unknown as Y.Array<string>;
  if (!orderArr) return;

  const diagramOrder = orderArr.toArray();
  for (const did of diagramOrder) {
    const diagram = diagramsMap.get(did);
    if (!diagram) continue;

    const gm = diagram.get(mxGraphModelKey) as YMxGraphModel | undefined;
    if (!gm) continue;

    const cellsMap = gm.get(mxCellKey) as Y.Map<Y.XmlElement> | undefined;
    const cellOrder = gm.get(mxCellOrderKey) as Y.Array<string> | undefined;
    if (!cellsMap || !cellOrder) continue;

    // 确保 cell 0 存在
    if (!cellsMap.has("0")) {
      const cell0 = new Y.XmlElement("mxCell");
      cell0.setAttribute("id", "0");
      cellsMap.set("0", cell0);
      console.warn(`[y-mxgraph] recreated missing cell 0 in diagram ${did}`);
    }
    if (!cellOrder.toArray().includes("0")) {
      cellOrder.insert(0, ["0"]);
    }

    // 确保 cell 1 存在
    if (!cellsMap.has("1")) {
      const cell1 = new Y.XmlElement("mxCell");
      cell1.setAttribute("id", "1");
      cell1.setAttribute("parent", "0");
      cellsMap.set("1", cell1);
      console.warn(`[y-mxgraph] recreated missing cell 1 in diagram ${did}`);
    }
    if (!cellOrder.toArray().includes("1")) {
      const idx0 = cellOrder.toArray().indexOf("0");
      cellOrder.insert(idx0 >= 0 ? idx0 + 1 : 0, ["1"]);
    }

    // 确保 cell 1 的 parent 是 "0"
    const cell1 = cellsMap.get("1");
    if (cell1 && cell1.getAttribute("parent") !== "0") {
      cell1.setAttribute("parent", "0");
    }

    // 确保 cell 0 的 id 属性正确
    const cell0 = cellsMap.get("0");
    if (cell0 && cell0.getAttribute("id") !== "0") {
      cell0.setAttribute("id", "0");
    }
  }
}
```

#### 2.2 `patch.ts` — 新增 syncCellsMapAndOrder 函数

**文件**：`src/yjs/binding/patch.ts`
**位置**：ensureRootCells 之后

```typescript
/**
 * 同步 cellsMap 和 cellsOrder，确保两者一致。
 * - cellsOrder 中 cellsMap 没有的 id → 从 cellsOrder 删除（保护 "0" "1"）
 * - cellsMap 中 cellsOrder 没有的 id → 添加到 cellsOrder
 */
export function syncCellsMapAndOrder(doc: Y.Doc): void {
  const mxfile = doc.getMap(mxfileKey) as YMxFile;
  const diagramsMap = mxfile.get(diagramKey) as unknown as Y.Map<YDiagram>;
  const orderArr = mxfile.get(diagramOrderKey) as unknown as Y.Array<string>;
  if (!orderArr) return;

  const diagramOrder = orderArr.toArray();
  for (const did of diagramOrder) {
    const diagram = diagramsMap.get(did);
    if (!diagram) continue;

    const gm = diagram.get(mxGraphModelKey) as YMxGraphModel | undefined;
    if (!gm) continue;

    const cellsMap = gm.get(mxCellKey) as Y.Map<Y.XmlElement> | undefined;
    const cellOrder = gm.get(mxCellOrderKey) as Y.Array<string> | undefined;
    if (!cellsMap || !cellOrder) continue;

    const mapKeys = new Set(cellsMap.keys());
    const currentOrder = cellOrder.toArray();

    // 1. 删除 cellsOrder 中 cellsMap 没有的（保护 "0" "1"）
    const toRemove = currentOrder.filter(
      (id) => !mapKeys.has(id) && !PROTECTED_CELLS.has(id)
    );
    if (toRemove.length > 0) {
      console.warn(
        `[y-mxgraph] sync: removing ${toRemove.length} orphan entries from cellsOrder in diagram ${did}`
      );
      toRemove.forEach((id) => {
        const idx = cellOrder.toArray().indexOf(id);
        if (idx !== -1) cellOrder.delete(idx, 1);
      });
    }

    // 2. 添加 cellsMap 中 cellsOrder 没有的
    const orderSet = new Set(cellOrder.toArray());
    const toAdd = Array.from(mapKeys).filter((id) => !orderSet.has(id));
    if (toAdd.length > 0) {
      console.warn(
        `[y-mxgraph] sync: adding ${toAdd.length} missing entries to cellsOrder in diagram ${did}`
      );
      // 受保护的 id 优先插入到前面
      const protectedToAdd = toAdd.filter((id) => PROTECTED_CELLS.has(id));
      const normalToAdd = toAdd.filter((id) => !PROTECTED_CELLS.has(id));

      for (const id of protectedToAdd) {
        const insertIdx = id === "0" ? 0 : cellOrder.toArray().indexOf("0") + 1;
        cellOrder.insert(Math.max(0, insertIdx), [id]);
      }
      cellOrder.push(normalToAdd);
    }
  }
}
```

#### 2.3 `binding/index.ts` — 在关键时机调用恢复函数

**文件**：`src/yjs/binding/index.ts`

**调用点 1**：初始化时（第 42 行 `initDocSnapshot` 之后）

```typescript
// 初始化 doc 快照
initDocSnapshot(doc);

// ← 新增：确保根节点存在 + 同步一致性
ensureRootCells(doc);
syncCellsMapAndOrder(doc);
```

**调用点 2**：应用远端/撤销 patch 后（第 84 行 `file.patch` 之后）

```typescript
suppressLocalApply = true;
try {
  file.patch([patch]);
  file.setShadowPages(file.ui.clonePages(file.ui.pages));
  // ← 新增：patch 应用后确保根节点完整
  ensureRootCells(doc);
} finally {
  suppressLocalApply = false;
}
```

**调用点 3**：本地 change 事件后（第 54 行 `applyFilePatch` 之后）

```typescript
applyFilePatch(doc, patch, { origin: LOCAL_ORIGIN });
// ← 新增：本地修改后确保根节点完整
ensureRootCells(doc);
```

---

### Phase 3：序列化防护

#### 3.1 `mxGraphModel.ts` — serialize 容错

**文件**：`src/yjs/models/mxGraphModel.ts`
**位置**：第 52-63 行

```typescript
export function serialize(map: YMxGraphModel) {
  const cells = map.get(mxCellKey) as unknown as Y.Map<Y.XmlElement>;
  const cellsOrder = map.get(mxCellOrderKey) as unknown as Y.Array<string>;

  const orderedCells = cellsOrder
    .toArray()
    .filter((id) => {
      const cell = cells.get(id);
      if (!cell) {
        console.warn(`[y-mxgraph] serialize: cell "${id}" in order but not in cellsMap, skipping`);
        return false;
      }
      return true;
    })
    .map((id) => serializeMxCell(cells.get(id) as Y.XmlElement));

  return {
    _attributes: {},
    root: {
      [mxCellKey]: orderedCells,
    },
  };
}
```

---

### Phase 4：测试

#### 4.1 新增测试文件 `tests/cell-protection.test.ts`

**覆盖场景**：

1. **applyFilePatch 无法删除 cell 0**
   - patch 含 `r: ["0"]` → cell 0 仍在 cellsOrder 和 cellsMap 中
2. **applyFilePatch 无法删除 cell 1**
   - patch 含 `r: ["1"]` → cell 1 仍在 cellsOrder 和 cellsMap 中
3. **applyFilePatch 无法同时删除 cell 0 和 1**
   - patch 含 `r: ["0", "1"]` → 两者都在
4. **generatePatch 不传播 cell 0/1 删除**
   - 手动从 cellsOrder 移除 "0" → generatePatch 不产生 `r: ["0"]`
5. **ensureRootCells 恢复缺失的 cell 0**
   - cellsMap 删除 "0" → ensureRootCells → cell 0 重新创建
6. **ensureRootCells 恢复缺失的 cell 1**
   - cellsMap 删除 "1" → ensureRootCells → cell 1 重新创建
7. **ensureRootCells 恢复 cellsOrder 中缺失的 cell 0**
   - cellsOrder 删除 "0" → ensureRootCells → "0" 补回
8. **ensureRootCells 恢复 cellsOrder 中缺失的 cell 1**
   - cellsOrder 删除 "1" → ensureRootCells → "1" 补回
9. **ensureRootCells 修复 cell 1 的 parent**
   - cell 1 的 parent 改为非 "0" → ensureRootCells → parent 恢复为 "0"
10. **syncCellsMapAndOrder 清理 cellsOrder 中不存在的 id**
    - cellsOrder 含 "ghost" 但 cellsMap 没有 → sync 后 "ghost" 被删除
11. **syncCellsMapAndOrder 补回 cellsMap 中 cellsOrder 缺失的 id**
    - cellsMap 有 "hidden" 但 cellsOrder 没有 → sync 后 "hidden" 被添加
12. **syncCellsMapAndOrder 不删除受保护的 cell**
    - cellsOrder 有 "0" "1" 但 cellsMap 没有 → sync 后 "0" "1" 仍在
13. **serialize 不 crash 当 cellsOrder 有不存在的 id**
    - cellsOrder 含 "ghost" 但 cellsMap 没有 → serialize 跳过并 warn
14. **完整流程：删除 cell 0 → ensureRootCells → 恢复**
    - 模拟完整删除流程 → ensureRootCells → 验证 cell 0/1 存在
15. **完整流程：cellsOrder 乱序 → sync → 一致**
    - cellsOrder 有重复/不存在的 id → sync 后一致
16. **diffPages 结果过滤**
    - 模拟 diffPages 返回含 cell 0/1 的 DIFF_REMOVE → binding 过滤后不应用

---

### Phase 5：提交

1. 所有测试通过后，提交到新分支 `fix/cell-0-1-protection`
2. 推送并创建 PR

---

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/yjs/binding/patch.ts` | 修改 | applyFilePatch DELETE 保护 + generatePatch 保护 |
| `src/yjs/binding/patch.ts` | 新增 | `ensureRootCells()` + `syncCellsMapAndOrder()` |
| `src/yjs/binding/index.ts` | 修改 | 3 处调用 ensureRootCells + import |
| `src/yjs/binding/index.ts` | 修改 | diffPages 结果过滤 |
| `src/yjs/models/mxGraphModel.ts` | 修改 | serialize 容错 |
| `tests/cell-protection.test.ts` | 新增 | 16 个测试用例 |

## 风险评估

| 风险 | 级别 | 缓解 |
|------|------|------|
| ensureRootCells 在每个 change 事件后运行 | 低 | 只在有 diagram 的 doc 上操作，O(diagramCount) |
| 过滤 diffPages 可能影响 draw.io 正常功能 | 中 | 只过滤 DELETE，不影响 INSERT/UPDATE |
| serialize 跳过不存在的 cell 可能丢数据 | 低 | 有 warn 日志，且 syncCellsMapAndOrder 会修复 |
