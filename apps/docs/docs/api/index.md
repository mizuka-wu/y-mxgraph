# API 概览

`y-mxgraph` 导出以下内容：

| 名称 | 类型 | 说明 |
|---|---|---|
| `bindDrawioFile` | function | 将 draw.io file 与 Y.Doc 双向绑定 |
| `xml2doc` | function | draw.io XML → Y.Doc |
| `doc2xml` | function | Y.Doc → draw.io XML |
| `LOCAL_ORIGIN` | object | 标记本地事务的 origin 标识 |

```ts
import {
  bindDrawioFile,
  xml2doc,
  doc2xml,
  LOCAL_ORIGIN,
} from 'y-mxgraph';
```
