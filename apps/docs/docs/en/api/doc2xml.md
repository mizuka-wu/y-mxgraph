# ydoc2xml

Serializes a `Y.Doc` to a draw.io XML string.

## Signature

```ts
function ydoc2xml(doc: Y.Doc, spaces?: number): string
```

## Parameters

- `doc` — the `Y.Doc` to serialize.
- `spaces` — optional indent width, defaults to `0` (compact). Pass `2` or `4` for human-readable output.

## Return Value

A draw.io XML string (`<mxfile>` or `<mxGraphModel>`, depending on the data stored in `doc`).

## Example

```ts
import * as Y from 'yjs';
import { xml2ydoc, ydoc2xml } from 'y-mxgraph';

const doc = new Y.Doc();
xml2ydoc(myXmlString, doc);

const output = ydoc2xml(doc, 2);
console.log(output);
```
