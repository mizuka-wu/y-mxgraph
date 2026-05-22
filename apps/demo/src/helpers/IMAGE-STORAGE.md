# Image Storage Helper

将 draw.io 的 base64 图片提取到 IndexedDB 存储，Y.Doc 只同步 `img:<uuid>` 引用，避免数据膨胀。

## 问题

draw.io 默认将图片以 base64 格式嵌入 cell 的 `style` 属性：

```
shape=image;image=data:image/png,iVBORw0KGgo...
```

这导致：
- Y.Doc 体积快速膨胀
- 图片尺寸受限
- 同步性能下降

## 解决方案

```
┌─────────────────────────────────────────────────────────────────┐
│  用户拖拽/粘贴图片                                                │
│  ↓                                                              │
│  draw.io 创建 cell (style 含 base64)                             │
│  ↓                                                              │
│  transformImagePatch 拦截 patch                                  │
│  ↓                                                              │
│  移除 base64 cell，异步上传到 IndexedDB                           │
│  ↓                                                              │
│  上传完成 → 更新 cell style 为 image=img:<uuid>                   │
│  ↓                                                              │
│  新 patch 同步 img:<uuid> 到 Y.Doc                               │
└─────────────────────────────────────────────────────────────────┘
```

## 使用方法

### 1. 配置 Binding

```typescript
import { Binding } from "y-mxgraph";
import {
  transformImagePatch,
  configureImageStorage,
  injectImageStorageHooks,
} from "./helpers/image-storage.js";

// 配置 graph 引用（用于上传后更新 cell）
const graph = editor.graph;
configureImageStorage({ graph });

// 注入渲染钩子
injectImageStorageHooks();

// 创建 Binding 时传入 transformPatch
const binding = new Binding(file, {
  doc,
  transformPatch: transformImagePatch,
});
```

### 2. 自定义上传函数（可选）

默认使用 IndexedDB，也可以配置为 OSS：

```typescript
configureImageStorage({
  uploadImage: async (base64: string) => {
    // 上传到 OSS
    const response = await fetch("https://oss.example.com/upload", {
      method: "POST",
      body: base64,
    });
    const { url } = await response.json();
    return `img:${url}`;
  },
  graph,
});
```

## API

### `configureImageStorage(options)`

配置图片存储。

| 参数 | 类型 | 说明 |
|------|------|------|
| `uploadImage` | `(base64: string) => Promise<string>` | 自定义上传函数，返回 `img:<id>` |
| `graph` | `mxGraph` | draw.io graph 实例，用于上传后更新 cell |

### `transformImagePatch(patch)`

`Binding` 的 `transformPatch` 回调，拦截 base64 图片。

```typescript
const binding = new Binding(file, {
  doc,
  transformPatch: transformImagePatch,
});
```

### `injectImageStorageHooks()`

注入 draw.io 渲染钩子，处理 `img:<uuid>` 引用：
- `mxJsCanvas.prototype.rewriteImageSource`
- `mxAsyncCanvas.prototype.rewriteImageSource`
- `mxSvgCanvas2D.prototype.image`

### `preloadAllImages(imageRefs)`

批量预加载图片到缓存。

```typescript
const refs = scanImageRefs(graph.getModel());
await preloadAllImages(refs);
```

### `scanImageRefs(model)`

扫描 model 中所有 `img:<uuid>` 引用。

### `releaseAllBlobUrls()`

释放所有 blob URL，释放内存。

## 限制

- **仅本地存储**：默认使用 IndexedDB，图片不跨浏览器/设备同步
- **同浏览器共享**：同一浏览器的多个标签页共享 IndexedDB
- **需要 OSS**：如需跨设备同步，需配置自定义 `uploadImage` 函数

## 数据流

```
上传流程:
  base64 → IndexedDB (本地) → img:<uuid> → Y.Doc (同步)

渲染流程:
  img:<uuid> → blobUrlCache (内存) → rewriteImageSource → draw.io

跨标签页流程:
  Tab A: 上传 → IndexedDB
  Tab B: 收到 img:<uuid> → 从 IndexedDB 加载 → 渲染
```
