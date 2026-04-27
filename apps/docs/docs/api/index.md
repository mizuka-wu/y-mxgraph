# API 概览

`y-mxgraph` 导出以下内容：

| 名称 | 类型 | 说明 |
|---|---|---|
| `bindDrawioFile` | function | 将 draw.io file 与 Y.Doc 双向绑定 |
| `BindDrawioFileOptions` | type | bindDrawioFile 的 options 类型 |
| `BindDrawioFileResult` | type | bindDrawioFile 的返回值类型 |
| `xml2doc` | function | draw.io XML → Y.Doc |
| `doc2xml` | function | Y.Doc → draw.io XML |
| `LOCAL_ORIGIN` | object | 标记本地事务的 origin 标识 |
| `DEFAULT_USER_NAME_KEY` | string | Awareness 中用户名的默认字段 |
| `DEFAULT_USER_COLOR_KEY` | string | Awareness 中颜色的默认字段 |

```ts
import {
  bindDrawioFile,
  xml2doc,
  doc2xml,
  LOCAL_ORIGIN,
  DEFAULT_USER_NAME_KEY,
  DEFAULT_USER_COLOR_KEY,
} from 'y-mxgraph';
import type { BindDrawioFileOptions, BindDrawioFileResult } from 'y-mxgraph';
```
