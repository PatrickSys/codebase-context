# CLI Gallery (Human-readable)

`codebase-context` exposes its tools as a local CLI so humans can:

- Get the conventions map before exploring or editing (`map`)
- Onboard themselves onto an unfamiliar repo
- Debug what the MCP server is doing
- Use outputs in CI/scripts (via `--json`)

> Output depends on the repo you run it against. The examples below are illustrative (paths, counts, and detected frameworks will vary).
>
> The CLI is intentionally single-project per invocation. MCP multi-project routing and trusted-root auto-discovery are only for the MCP server; the CLI still targets one root via `CODEBASE_ROOT` or the current working directory.

## How to run

```bash
# Run from a repo root, or set CODEBASE_ROOT explicitly:
CODEBASE_ROOT=/path/to/repo npx -y codebase-context status

# Every command supports --json (machine output). Human mode is default.
npx -y codebase-context patterns --json
```

### ASCII fallback

If your terminal doesn’t render Unicode box-drawing cleanly:

```bash
CODEBASE_CONTEXT_ASCII=1 npx -y codebase-context patterns
```

## Commands

- `map` — conventions map: architecture layers, patterns, golden files
- `metadata` — tech stack overview
- `patterns` — team conventions + adoption/trends
- `search --query <q>` — ranked results; add `--intent edit` for a preflight card
- `refs --symbol <name>` — concrete reference evidence
- `cycles` — circular dependency detection
- `status` — index status/progress
- `reindex` — rebuild index (full or incremental)
- `style-guide` — find style guide sections in docs
- `memory list|add|remove` — manage team memory (stored in `.codebase-context/memory.json`)

---

## `map`

```bash
npx -y codebase-context map
```

The conventions map — run this first on an unfamiliar repo. Shows architecture layers, active patterns with adoption rates and trend direction, and the golden files the team treats as the strongest examples. This is also what the MCP server delivers to AI agents via the `codebase://context` resource on first call.

Example output (truncated):

```text
┌─ Codebase Map ── angular-spotify ────────────────────────────────────┐
│                                                                      │
│ Architecture: feature-based · 3 layers                               │
│ 47 files · 6 patterns · 3 golden files                               │
│                                                                      │
│ LAYERS                                                               │
│   core/      – shared services + DI                                  │
│   features/  – domain modules                                        │
│   shared/    – reusable components                                   │
│                                                                      │
│ TOP PATTERNS                                                         │
│      Angular standalone components   92%  ↑ Rising                  │
│      RxJS reactive patterns          78%                             │
│   ↓  NgModules                        8%  Declining                  │
│                                                                      │
│ GOLDEN FILES                                                         │
│   src/features/player/player.component.ts                            │
│   src/core/auth/auth.service.ts                                      │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## `metadata`

```bash
npx -y codebase-context metadata
```

Example output:

```text
┌─ codebase-context [monorepo] ────────────────────────────────────────┐
│                                                                      │
│ Framework: Angular unknown   Architecture: mixed                     │
│ 130 files · 24,211 lines · 1077 components                           │
│                                                                      │
│ Dependencies: @huggingface/transformers · @lancedb/lancedb ·         │
│ @modelcontextprotocol/sdk · @typescript-eslint/typescript-estree ·   │
│ chokidar · fuse.js (+14 more)                                        │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## `patterns`

```bash
npx -y codebase-context patterns
```

Example output (truncated):

```text
┌─ Team Patterns ──────────────────────────────────────────────────────┐
│                                                                      │
│ UNIT TEST FRAMEWORK                                                  │
│      USE: Vitest – 96% adoption                                      │
│ alt  CAUTION: Jest – 4% minority pattern                             │
│                                                                      │
│ STATE MANAGEMENT                                                     │
│      PREFER: RxJS – 63% adoption                                     │
│ alt  Redux-style store – 25%                                         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## `search`

```bash
npx -y codebase-context search --query "file watcher" --intent edit --limit 3
```

Example output (truncated):

```text
┌─ Search: "file watcher" ─── intent: edit ────────────────────────────┐
│ Quality: ok (1.00)                                                   │
│ Ready to edit: YES                                                   │
│                                                                      │
│ Best example: index.ts                                               │
└──────────────────────────────────────────────────────────────────────┘

1.  src/core/file-watcher.ts:44-74
    confidence: ██████████ 1.18
    typescript module in file-watcher.ts: startFileWatcher :: (...)
```

## `refs`

```bash
npx -y codebase-context refs --symbol "startFileWatcher" --limit 10
```

Example output (truncated):

```text
┌─ startFileWatcher ─── 11 references ─── static analysis ─────────────┐
│                                                                      │
│ startFileWatcher                                                     │
│ │                                                                    │
│ ├─ file-watcher.test.ts:5                                            │
│ │   import { startFileWatcher } from '../src/core/file-watcher....   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## `cycles`

```bash
npx -y codebase-context cycles --scope src
```

Example output:

```text
┌─ Circular Dependencies ──────────────────────────────────────────────┐
│                                                                      │
│ No cycles found  ·  98 files  ·  260 edges  ·  2.7 avg deps          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## `status`

```bash
npx -y codebase-context status
```

Example output:

```text
┌─ Index Status ───────────────────────────────────────────────────────┐
│                                                                      │
│ State: ready                                                         │
│ Root:  /path/to/repo                                                 │
│                                                                      │
│ → Run `reindex` to re-index (`--incremental` skips unchanged).       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## `reindex`

```bash
npx -y codebase-context reindex
npx -y codebase-context reindex --incremental --reason "changed watcher logic"
```

> **MCP server mode**: if you're running codebase-context as an MCP server (long-running process), the index auto-refreshes via a file watcher — you don't need to call `reindex` between edits. Use `reindex` for one-shot CLI runs or to force a full rebuild.

## `style-guide`

```bash
npx -y codebase-context style-guide --query "naming"
```

Example output:

```text
No style guides found.
  Hint: Try broader terms like 'naming', 'patterns', 'testing', 'components'
```

## `memory`

```bash
npx -y codebase-context memory list
npx -y codebase-context memory list --query "watcher"

npx -y codebase-context memory add \
  --type gotcha \
  --category tooling \
  --memory "Use pnpm, not npm" \
  --reason "Workspace support and speed"

npx -y codebase-context memory remove <id>
```
