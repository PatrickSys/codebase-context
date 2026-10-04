# CLI Gallery (Human-readable)

`codebase-context` exposes its tools as a local CLI so humans can follow the same map-first workflow the MCP server gives to agents:

- Get the bounded conventions map before exploring or editing (`map`)
- Search for the right local example after the map narrows the repo shape
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

### Local model-free candidate

These options belong to the modified local candidate, not the published npm package.
Use the executable from the candidate installation; do not replace it with an unpinned
`npx` command during evaluation. From the project to be indexed:

```bash
codebase-context reindex --no-embeddings --json
codebase-context search --query "your exact symbol" --json
# Edit, delete, add, or move source files, then update:
codebase-context reindex --incremental --json
codebase-context search --query "your exact symbol" --json
```

`--no-embeddings` disables both embedding inference and the cross-encoder reranker.
The successful build records this choice in the existing index metadata. Later full
or incremental rebuilds, automatic refreshes, and new CLI/MCP processes retain that
choice when no mode flag is given. Search never enables models just because a query
is ambiguous. The optional model packages remain installed for semantic opt-in; this
mode does not remove dependencies or delete pre-existing model caches.

For a fresh MCP project, launch the installed executable with a project root and an
explicit startup choice:

```bash
codebase-context --no-embeddings "/absolute/path/to/project"
```

MCP `refresh_index` accepts `{ "skipEmbedding": true }` to choose model-free mode,
`{ "skipEmbedding": false }` to choose semantic mode, or no field to retain the last
successful choice. The launch flag selects the initial build mode; subsequent
explicit refreshes can change it. An already-running build must finish before another
manual mode change is accepted. A mode transition always requires a full rebuild,
even when incremental mode was requested and the source files did not change.

To opt back into models with the CLI, use `codebase-context reindex --embeddings`.
A fresh project without a choice and supported older metadata without the new mode
field retain the existing semantic default. Both mode flags together, boolean values
attached to them, and mode flags on search are rejected rather than silently ignored.

Source locations are checked against the current files. Stale or foreign-root data
must not be served: the caller receives a rebuild/retry response instead. When the
metadata needed to recover the mode is missing or corrupt, automatic rebuilding
cannot safely choose a model policy. The response is explicitly `rebuild-required`;
recover with `reindex --no-embeddings` or `reindex --embeddings` (or the corresponding
MCP field). Structurally valid older metadata can still migrate automatically.

The MCP launch flag is reapplied on every process start to each project that process
initializes. A saved `--no-embeddings` launch command therefore deliberately switches
back to model-free mode after a semantic refresh in a previous session. Without a
launch flag, the last successful metadata controls the mode. Deleting **all** index
artifacts removes that remembered choice: the project is fresh again. Keep the
`--no-embeddings` flag in the saved launch command when model-free operation must
also survive complete index deletion.

Use one index writer per project. In-process overlapping refreshes are rejected as
`busy`, but this candidate does not add a cross-process lock. Stop the MCP watcher
before changing modes with a separate CLI process; otherwise existing last-writer
filesystem behavior can race. Do not treat concurrent writers as a supported mode
transition workflow.

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

The conventions map - run this first on an unfamiliar repo. It shows architecture layers, active patterns with adoption rates and trend direction, and the golden files the team treats as the strongest examples. This is also what the MCP server delivers to AI agents via the `codebase://context` resource on first call, before search narrows to a specific local example.

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
