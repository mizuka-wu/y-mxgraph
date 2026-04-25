# xml2doc

将 draw.io XML 字符串解析并填充到 `Y.Doc` 中。

## 签名

```ts
function xml2doc(xml: string, doc: Y.Doc): Y.Doc
```

## 参数

- `xml` — draw.io XML 字符串，支持 `<mxfile>` 多页面或 `<mxGraphModel>` 单模型两种格式。
- `doc` — **必填**，外部传入的 `Y.Doc`，解析结果将写入此 doc。

## 返回值

传入的 `Y.Doc`（便于链式调用）。

## 示例

```ts
import * as Y from 'yjs';
import { xml2doc } from 'y-mxgraph';

const doc = new Y.Doc();
const xmlStr = `<mxfile><diagram name="Page-1" id="abc">...</diagram></mxfile>`;

xml2doc(xmlStr, doc);
```
