# ydoc2xml

将 `Y.Doc` 序列化为 draw.io XML 字符串。

## 签名

```ts
function ydoc2xml(doc: Y.Doc, spaces?: number): string
```

## 参数

- `doc` — 要序列化的 `Y.Doc`。
- `spaces` — 可选，缩进空格数，默认 `0`（紧凑格式）。传入 `2` 或 `4` 可获得人类可读格式。

## 返回值

draw.io XML 字符串（`<mxfile>` 或 `<mxGraphModel>`，取决于 `doc` 中存储的数据格式）。

## 示例

```ts
import * as Y from 'yjs';
import { xml2ydoc, ydoc2xml } from 'y-mxgraph';

const doc = new Y.Doc();
xml2ydoc(myXmlString, doc);

const output = ydoc2xml(doc, 2);
console.log(output);
```
