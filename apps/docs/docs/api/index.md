# API 概览

`y-mxgraph` 导出以下内容：

| 名称 | 类型 | 说明 |
|---|---|---|
| `Binding` | class | draw.io file 与 Y.Doc 的绑定类 |
| `BindDrawioFileOptions` | type | Binding 构造函数的 options 类型 |
| `xml2doc` | function | draw.io XML → Y.Doc |
| `doc2xml` | function | Y.Doc → draw.io XML |
| `LOCAL_ORIGIN` | object | 标记本地事务的 origin 标识 |
| `DEFAULT_USER_NAME_KEY` | string | Awareness 中用户名的默认字段 |
| `DEFAULT_USER_COLOR_KEY` | string | Awareness 中颜色的默认字段 |

```ts
import {
  Binding,
  xml2doc,
  doc2xml,
  LOCAL_ORIGIN,
  DEFAULT_USER_NAME_KEY,
  DEFAULT_USER_COLOR_KEY,
} from 'y-mxgraph';
import type { BindDrawioFileOptions } from 'y-mxgraph';
```
