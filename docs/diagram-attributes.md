# diagram 标签属性总结

## 必需属性（固定处理，不会被自定义同步）

| 属性名 | 类型 | 说明 | 示例 |
|--------|------|------|------|
| `id` | string | diagram 的唯一标识符 | `"page1"` |
| `name` | string | 页面名称（显示在标签上） | `"Page-1"` |

## 常用固定属性（推荐同步）

| 属性名 | 类型 | 说明 | 常见值 |
|--------|------|------|--------|
| `pages` | string | 页数标识 | `"1"`, `"2"`, `"3"` |
| `background` | string | 背景颜色/图片 | `"#ffffff"`, `"url(https://...)"` |
| `pageCount` | string | 页面总数 | `"1"`, `"2"` |
| `pageVisible` | string | 页面可见性 | `"0"`, `"1"` |
| `pageScale` | string | 页面缩放比例 | `"1"`, `"0.5"`, `"1.5"` |
| `pageWidth` | string | 页面宽度 (px) | `"816"`, `"1024"` |
| `pageHeight` | string | 页面高度 (px) | `"577"`, `"728"` |

## 可选属性（按需同步）

| 属性名 | 类型 | 说明 | 常见值 |
|--------|------|------|--------|
| `connections` | string | 连接集合 | - |
| `connectLinks` | string | 连接链接数 | - |
| `autoConnect` | string | 自动连接 | `"0"`, `"1"` |
| `gridSize` | string | 网格大小 | `"10"`, `"20"` |
| `printScale` | string | 打印缩放 | `"1"`, `"0.75"` |
| `isPage` | string | 是否独立页面 | `"0"`, `"1"` |
| `pageMargin` | string | 页面边距 | `"20"` |

## 低频使用属性（通常不需要同步）

| 属性名 | 说明 |
|--------|------|
| `printPageBreak` | 打印分页符 |
| `notebookOverflow` | 笔记本溢出处理 |
| `collapseContent` | 折叠内容 |
| `fitPanic` | 适应模式 |
| `preserveImageAspect` | 保持图片比例 |

## 使用说明

### 默认行为
- 只同步 **必需属性** (`id`, `name`) + **常用固定属性** 到 Y.Doc
- 其他属性不会被自动同步

### 自定义配置
可以通过 `DiagramOptions` 配置同步哪些属性：

```typescript
import { xml2ydoc } from "y-mxgraph";
import { DEFAULT_DIAGRAM_FIXED_ATTRIBUTES } from "y-mxgraph/models/diagram";

// 方案 1: 使用默认白名单 (推荐)
xml2ydoc(xml, doc);

// 方案 2: 禁用所有固定属性同步
xml2ydoc(xml, doc, { fixedAttributes: new Set() });

// 方案 3: 自定义白名单 (只显示方式相关属性)
xml2ydoc(xml, doc, {
  fixedAttributes: new Set([
    "background",  // 背景
    "pageScale",   // 缩放比例
    "pageWidth",   // 页面宽度
    "pageHeight",  // 页面高度
  ])
});

// 方案 4: 继承默认白名单并添加自定义属性
xml2ydoc(xml, doc, {
  fixedAttributes: new Set([...DEFAULT_DIAGRAM_FIXED_ATTRIBUTES, "myCustomAttr"])
});
```

## 属性分类建议

### 高优先级（建议默认同步）
- `background` - 背景设置
- `pageScale`, `pageWidth`, `pageHeight` - 页面显示尺寸
- `pageVisible` - 页面可见性

### 中优先级（按需同步）
- `pages`, `pageCount` - 多页配置
- `gridSize`, `pageMargin` - 布局设置

### 低频（不需要同步）
- `connections`, `connectLinks` - 连接数据（在 mxGraphModel 中）
- 其他状态/打印相关属性

## 注意事项

1. `id` 和 `name` **不会**被包含在自定义属性 Map 中，它们单独处理
2. 只有白名单内的属性才会被同步到 `fixedAttributes` Map
3. 白名单外的属性会被**忽略**，不会出现在同步结果中
4. 可以通过配置空 Set 禁用所有固定属性同步
