# AGENTS.md

## What This Is

Yjs binding for draw.io (mxGraph) — enables real-time collaborative diagram editing. Monorepo with pnpm workspaces + Turborepo.

## Monorepo Structure

```
packages/
  y-mxgraph/          # Core library (published to npm as "y-mxgraph")
  iframe-bridge/      # @y-mxgraph/iframe-bridge — postMessage bridge for iframe isolation
  typescript-config/  # Shared tsconfig (base.json, vite.json)
  eslint-config/      # Shared ESLint config (extends @typescript-eslint + prettier)
apps/
  demo/                        # @y-mxgraph/demo — WebRTC demo (Playwright e2e tests here)
  simple-y-websocket-server-demo/  # @y-mxgraph/websocket-demo — WebSocket server demo (local dev only)
  docs/                        # @y-mxgraph/docs — VitePress documentation site
```

## Commands

```bash
# Install (always pnpm)
pnpm install

# Build everything
pnpm build

# Build core library only (required before demo/docs build)
pnpm --filter y-mxgraph build

# Run unit tests
pnpm --filter y-mxgraph test

# Run unit tests with coverage
pnpm --filter y-mxgraph test:coverage

# Watch mode for type checking (no emit)
pnpm --filter y-mxgraph dev

# Lint core library
pnpm --filter y-mxgraph lint

# Run demo (single-page WebRTC mode)
pnpm --filter @y-mxgraph/demo dev

# Run WebSocket demo (requires TWO terminals)
pnpm --filter @y-mxgraph/websocket-demo server  # Terminal 1: server on ws://localhost:2345
pnpm --filter @y-mxgraph/websocket-demo dev     # Terminal 2: client on http://localhost:5174

# Run docs site
pnpm --filter @y-mxgraph/docs dev

# E2E tests (demo app)
pnpm --filter @y-mxgraph/demo test:e2e
pnpm --filter @y-mxgraph/demo test:e2e:ui  # With Playwright UI

# Format code
pnpm format
```

## Build Order Matters

`y-mxgraph` must build before `demo`, `websocket-demo`, or `docs` — they depend on workspace link. Turbo handles this via `"dependsOn": ["^build"]`, but if building manually, build `y-mxgraph` first.

## Core Library Architecture (`packages/y-mxgraph`)

- **Entry**: `src/index.ts` — exports `Binding`, `xml2ydoc`, `ydoc2xml`, `LOCAL_ORIGIN`
- **Binding** (`src/binding/`): Main class. Binds draw.io `file` to `Y.Doc`. Handles bidirectional sync, undo/redo, collaborator cursors.
- **transform** (`src/transform/`): `xml2ydoc(xml, doc)` and `ydoc2xml(doc)` — converts between draw.io XML and Y.Doc structure.
- **Models** (`src/models/`): Y.Doc data structure — `mxfile` → `diagram` map + `diagramOrder` array → `mxGraphModel` per diagram.
- **iframe-bridge** (`src/iframe-bridge/`): Re-exports from `@y-mxgraph/iframe-bridge` package.

### Y.Doc Structure

```
Y.Doc
  └─ mxfile (Y.Map)
       ├─ pages: "1"
       ├─ diagram (Y.Map<Y.Map>) — keyed by diagram id
       │    └─ <id> → Y.Map with mxGraphModel data
       └─ diagramOrder (Y.Array<string>) — page ordering
```

### Critical API Decisions

- `file.ui.setFileData(xml)` is used (NOT `file.setData(xml)`) to avoid draw.io's "Save diagrams to:" dialog
- `disableBeforeUnload` defaults to `true` — Yjs handles persistence, draw.io's native save prompts are suppressed
- Initial content strategies: `replace` (default), `merge-remote`, `merge-client`
- `Binding.generateFileTemplate(diagramId)` produces deterministic XML with fixed diagram id — prevents multi-client id mismatch

## iframe-bridge Package (`packages/iframe-bridge`)

Two roles:

- **Server** (parent page): manages network provider (y-webrtc/y-websocket), syncs Y.Doc + Awareness to iframes via postMessage
- **Provider** (iframe child): local Y.Doc + Awareness (or AwarenessLike), synced with server via postMessage

Exports: `createIframeBridgeServer()`, `createIframeBridgeProvider()`, `AwarenessLike`

### Provider API

`createIframeBridgeProvider(doc, options?)` — `awareness` 从第二个参数移到 `options` 中，变为可选：

- 不传 `awareness` → 内部创建 `AwarenessLike`，自动与父容器同步（通过 `awareness-local-state` 消息，50ms 节流）
- 传入 `awareness` → 使用外部 Awareness 实例，保持原有 hack 同步逻辑

Provider 返回 `bridge.awareness`，可直接传给 `Binding`。

### Awareness User Info

- **AwarenessLike 模式**（不传 awareness）：provider 内部管理 awareness，`setLocalState`/`setLocalStateField` 自动发送给父容器；`awareness-sync` 时 remap server clientID 到本地 clientID，确保 `bindCollaborator` 能读取到 server 设置的 user 信息
- **外部 Awareness 模式**（传入 awareness）：父容器 awareness 为准，iframe provider **不应**主动推送本地 awareness state 给 server，server 在 `awareness-sync` 时将父容器 awareness 推送给 iframe，iframe 接收后同步到本地
- **`bindCollaborator`** (`packages/y-mxgraph/src/binding/collaborator/index.ts`) 监听本地 awareness user 变化（如 iframe-bridge 同步），更新内部缓存的 `userName`/`userColor`，避免 binding 生成的随机值覆盖外部设置
- **iframe demo 支持设置初始 awareness user**：`iframe.html` toolbar 提供 User Name 和 Color 输入框，值通过 URL 参数 `userName`/`userColor` 传给 iframe；`iframe-container.ts` 在创建 provider **立即**设置父容器 awareness user，确保 server 延迟创建时也能正确同步

## Testing

### Unit Tests (Vitest)

Location: `packages/y-mxgraph/tests/`

```
binding.test.ts              # Binding class tests
binding-initial-content.test.ts  # Initial content strategy tests
origin.test.ts               # LOCAL_ORIGIN tests
patch.test.ts                # Patch generation/application
transform.test.ts          # xml2ydoc / ydoc2xml
```

Config: `packages/y-mxgraph/vitest.config.ts` — environment: node, includes `src/**` and `tests/**`

### E2E Tests (Playwright)

Location: `apps/demo/e2e/`

Config: `apps/demo/playwright.config.ts` — Chromium only, port 5174, sequential execution (`fullyParallel: false`, `workers: 1`)

## CI/CD (GitHub Actions)

- **deploy.yml**: On push to main/master → builds docs + demo → deploys to GitHub Pages
  - Demo deployed under `/y-mxgraph/demo/` subpath (`VITE_BASE` env)
- **release.yml**: On tag `v*` → builds library → publishes `packages/y-mxgraph/dist` to npm
- **docs.yml / demo.yml**: Manual standalone deploys (superseded by deploy.yml)

## TypeScript Config

- Strict mode enabled globally
- Library target: ES2020, module: ESNext, moduleResolution: bundler
- Apps use `@y-mxgraph/typescript-config/vite.json` (noEmit, stricter lint rules)

## Conventions

- ESM-only (`"type": "module"` in all package.json)
- Source code has Chinese comments — this is normal, don't "fix" them
- `@typescript-eslint/no-non-null-assertion` is OFF — `!` assertions are allowed
- Peer dependencies: `yjs` ^13.6.0 and `y-protocols` ^1.0.0 — never bundle these
- npm publish happens from `packages/y-mxgraph/dist/` (not root), with a generated package.json that has correct exports

## draw.io Integration Quirks

- draw.io loads from CDN (jsDelivr) in dev mode — `mxBasePath`, `RESOURCES_PATH`, `STENCIL_PATH` globals must point to CDN
- draw.io v26+ uses CSS Grid layout (`.geEditor { display: grid }`) — never set `display: block/none` on containers, use `style.removeProperty("display")`
- `file.patch()` updates internal data but does NOT trigger UI re-render — manual `file.ui.setFileData(xml)` needed after patch
- Demo apps use `App.main()` double-callback pattern: second callback creates Editor/App, first callback receives ready app

## What NOT to Do

- Don't run `pnpm install` with npm/yarn — this repo uses pnpm exclusively
- Don't build demo/docs without building y-mxgraph first
- Don't use `file.setData()` unless you intentionally want the "Save diagrams to:" dialog
- Don't hardcode diagram XML with random ids — use `Binding.generateFileTemplate()` for deterministic ids
- Don't set inline `display` styles on draw.io containers — breaks CSS Grid layout
