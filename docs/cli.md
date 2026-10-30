# CLI Gallery (Human-readable)

`codebase-context` exposes its tools as a local CLI so humans can follow the same map-first workflow the MCP server gives to agents:

- Get the bounded conventions map before exploring or editing (`map`)
- Search for the right local example after the map narrows the repo shape
- Onboard themselves onto an unfamiliar repo
- Debug what the MCP server is doing
- Use outputs in CI/scripts (via `--json`)

> Output depends on the repo you run it against. The examples below are illustrative (paths, counts, and detected frameworks will vary).
>
> These commands use the current npm release. The examples are illustrative and were not captured from the current npm package.
>
> These output examples come from an earlier CLI run and do not verify the current npm package or an MCP connection.
>
> The commands below use `codebase-context` and require Node.js 22 or newer. The CLI is intentionally single-project per invocation and targets one root via `CODEBASE_ROOT` or the current working directory. MCP registration and project selection are covered in the [client setup guide](./client-setup.md).

## How to run

```bash
# CLI only: run from a repo root, or set CODEBASE_ROOT explicitly:
CODEBASE_ROOT=/path/to/repo npx -y codebase-context status

# Commands that show --json in their help support machine output. Human mode is default.
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
- MCP client registration — use the recipes in the [client setup guide](./client-setup.md). Published 2.2.0 has the older interactive HTTP wizard; the four-client wizard below requires the unreleased candidate.

## `init` in the unreleased candidate

`init` detects Claude Code, Codex, Cursor and OpenCode, then configures the selected tools together. In a terminal, detected tools start selected; use Space to change the selection and Enter to apply it. Without a terminal, it configures all detected tools.

```powershell
codebase-context init --help
codebase-context init
codebase-context init --yes
codebase-context init --client codex --client cursor --root "C:\path\to\project"
```

Use repeatable `--client` options to choose tools explicitly. `--yes` configures every detected tool when no clients are named. `--root` selects another repository; otherwise `CODEBASE_ROOT` or the current directory is used. Setup writes client registrations but does not build an index or change agent instructions. The first search creates the index. The multi-tool flow is not in published npm `2.2.0` yet; see the [main setup guide](../README.md#set-up-your-ai-client) for its publication status and the [client setup guide](./client-setup.md) for current manual recipes.

The built candidate also supports `--version` and builds a missing index when you run `map`. New indexes use keyword search without a model download; `reindex --embeddings` explicitly enables local semantic search. Preview, reindex, and map apply the same project exclusions and analyzer hints. A low-confidence search result means the matches are weak; it does not establish that code is absent.

---

## First use

Run these CLI commands from the project root. Build or refresh the local index first; the first run downloads a local model and indexes the repository; time depends on repository size, CPU and model. Then inspect the conventions map and search for the code you need:

```bash
npx -y codebase-context reindex
npx -y codebase-context map
npx -y codebase-context search --query "auth middleware"
```

This is the CLI preparation flow. It is separate from MCP client registration and does not by itself show that an MCP client connected successfully.

## `map`

```bash
npx -y codebase-context reindex
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
npx -y codebase-context reindex
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

In the unreleased model-free candidate, use the locally installed package:

```bash
CODEBASE_ROOT=/path/to/repository node /path/to/cbc/node_modules/codebase-context/dist/index.js reindex
CODEBASE_ROOT=/path/to/repository node /path/to/cbc/node_modules/codebase-context/dist/index.js reindex --incremental
CODEBASE_ROOT=/path/to/repository node /path/to/cbc/node_modules/codebase-context/dist/index.js reindex --no-embeddings
# Requires the optional Transformers and LanceDB runtimes; may download models.
CODEBASE_ROOT=/path/to/repository node /path/to/cbc/node_modules/codebase-context/dist/index.js reindex --embeddings
```

New projects default to model-free. Omit mode flags to preserve the successful mode; explicit changes require a full rebuild even with `--incremental`. The two mode flags are mutually exclusive and index failures return nonzero. The examples below target the older published package.

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
