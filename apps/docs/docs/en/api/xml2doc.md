# xml2doc

Parses a draw.io XML string and populates a `Y.Doc` with the result.

## Signature

```ts
function xml2doc(xml: string, doc: Y.Doc): Y.Doc
```

## Parameters

- `xml` — a draw.io XML string. Supports both `<mxfile>` (multi-page) and `<mxGraphModel>` (single model) formats.
- `doc` — **required** — the externally provided `Y.Doc` to write into.

## Return Value

The same `Y.Doc` that was passed in (for chaining).

## Example

```ts
import * as Y from 'yjs';
import { xml2doc } from 'y-mxgraph';

const doc = new Y.Doc();
const xmlStr = `<mxfile><diagram name="Page-1" id="abc">...</diagram></mxfile>`;

xml2doc(xmlStr, doc);
```
