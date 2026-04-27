# API Overview

`y-mxgraph` exports the following:

| Name | Type | Description |
|------|------|-------------|
| `Binding` | class | Bidirectional binding between a draw.io file and a Y.Doc |
| `BindDrawioFileOptions` | type | Options type for the Binding constructor |
| `xml2doc` | function | Convert draw.io XML → Y.Doc |
| `doc2xml` | function | Convert Y.Doc → draw.io XML |
| `LOCAL_ORIGIN` | object | Origin marker for local transactions |
| `DEFAULT_USER_NAME_KEY` | string | Default awareness field for the user's display name |
| `DEFAULT_USER_COLOR_KEY` | string | Default awareness field for the user's color |

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
