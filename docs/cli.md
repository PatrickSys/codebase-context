# CLI Guide (Local Candidate)

`codebase-context` exposes its tools as a local CLI so humans can follow the same map-first workflow the MCP server gives to agents:

- Get the bounded conventions map before exploring or editing (`map`)
- Search for the right local example after the map narrows the repo shape
- Onboard themselves onto an unfamiliar repo
- Debug what the MCP server is doing
- Use outputs in CI/scripts (via `--json`)

> Output depends on the repo you run it against. The examples below are illustrative (paths, counts, and detected frameworks will vary).
>
> Commands below point to the actual entrypoint of a built checkout or installed local candidate; replace the path with your installation. The npm release checked on 3 November 2026 is `2.2.0`, which does not contain these candidate changes.
>
> Retained output illustrations come from earlier CLI runs. They are not measurements of this candidate or proof of an MCP connection.
>
> The candidate requires Node.js 22 or newer. The CLI is intentionally single-project per invocation and targets one root via `CODEBASE_ROOT` or the current working directory. MCP registration and project selection are covered in the [client setup guide](./client-setup.md).

## How to run

```bash
# CLI only: run from a repo root, or set CODEBASE_ROOT explicitly:
CODEBASE_ROOT=/path/to/repo node /path/to/codebase-context/dist/index.js status

# Commands that show --json in their help support machine output. Human mode is default.
node /path/to/codebase-context/dist/index.js patterns --json
```

### ASCII fallback

If your terminal doesn’t render Unicode box-drawing cleanly:

```bash
CODEBASE_CONTEXT_ASCII=1 node /path/to/codebase-context/dist/index.js patterns
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
node /path/to/codebase-context/dist/index.js init --help
node /path/to/codebase-context/dist/index.js init
node /path/to/codebase-context/dist/index.js init --yes
node /path/to/codebase-context/dist/index.js init --client codex --client cursor --root "C:\path\to\project"
```

Use repeatable `--client` options to choose tools explicitly. `--yes` configures every detected tool when no clients are named. `--root` selects another repository; otherwise `CODEBASE_ROOT` or the current directory is used. Setup writes client registrations but does not build an index or change agent instructions. The first search creates the index. The multi-tool flow is not in published npm `2.2.0` yet; see the [main setup guide](../README.md#set-up-your-ai-client) for its publication status and the [client setup guide](./client-setup.md) for current manual recipes.

The built candidate also supports `--version` and builds a missing index when you run `map`. New indexes use keyword search without a model download; `reindex --embeddings` explicitly enables semantic indexing with the configured provider. The default local provider uses Transformers; an explicitly configured remote provider does not require that local model runtime. Preview, reindex, and map apply the same project exclusions and analyzer hints. A low-confidence search result means the matches are weak; it does not establish that code is absent.

---

## First use

Run these candidate commands from the project root. A fresh index defaults to keyword-only mode without an embedding or reranker download. An existing index keeps its recorded mode, which may use embeddings. Indexing time depends on the repository and machine; no cold-start timing is promised here. Then inspect the map and search:

```bash
node /path/to/codebase-context/dist/index.js reindex
node /path/to/codebase-context/dist/index.js map
node /path/to/codebase-context/dist/index.js search --query "auth middleware"
```

This is the CLI preparation flow. It is separate from MCP client registration and does not by itself show that an MCP client connected successfully.

## `map`

```bash
node /path/to/codebase-context/dist/index.js reindex
node /path/to/codebase-context/dist/index.js map
```

The conventions map - run this first on an unfamiliar repo. It shows architecture layers, active patterns with adoption rates and trend direction, and example files selected from detected patterns. This is also what the MCP server delivers to AI agents via the `codebase://context` resource on first call, before search narrows to a specific local example.

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
node /path/to/codebase-context/dist/index.js metadata
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
node /path/to/codebase-context/dist/index.js patterns
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
node /path/to/codebase-context/dist/index.js reindex
node /path/to/codebase-context/dist/index.js search --query "file watcher" --intent edit --limit 3
```

Use a query from the repository you are inspecting. Search returns ranked file locations and a `searchQuality` object; scores are retrieval signals, not probabilities that an answer is correct. A low-confidence result is not proof that code is absent.

The CLI uses compact mode, which returns at most six results even when `--limit` is larger. For top-five checks, use `--limit 5 --json` and grade the actual returned files. MCP callers may request `mode="full"`; response budgeting still applies.

Candidate-budget exhaustion asks for a narrower symbol or path query. Changed or unavailable sources retain refresh guidance. Do not treat those two conditions as the same failure.

## `refs`

```bash
node /path/to/codebase-context/dist/index.js refs --symbol "startFileWatcher" --limit 10
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
node /path/to/codebase-context/dist/index.js cycles --scope src
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
node /path/to/codebase-context/dist/index.js status
```

Persisted generation counts and timestamps are available in a fresh process. In-memory run details are used only when their build id matches. Cap fields distinguish total from searchable chunks.

Historical illustration (not candidate measurements):

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
# Default local provider: requires optional Transformers and LanceDB; may download models.
# A configured remote provider still requires LanceDB, but not Transformers.
CODEBASE_ROOT=/path/to/repository node /path/to/cbc/node_modules/codebase-context/dist/index.js reindex --embeddings
```

New projects default to model-free. Omit mode flags to preserve the successful mode; explicit changes require a full rebuild even with `--incremental`. The two mode flags are mutually exclusive and index failures return nonzero. The examples below also target the local candidate.

```bash
node /path/to/codebase-context/dist/index.js reindex
node /path/to/codebase-context/dist/index.js reindex --incremental --reason "changed watcher logic"
```

> **MCP server mode**: if you're running codebase-context as an MCP server (long-running process), the index auto-refreshes via a file watcher — you don't need to call `reindex` between edits. Use `reindex` for one-shot CLI runs or to force a full rebuild.

## `style-guide`

```bash
node /path/to/codebase-context/dist/index.js style-guide --query "naming"
```

Example output:

```text
No style guides found.
  Hint: Try broader terms like 'naming', 'patterns', 'testing', 'components'
```

## `memory`

```bash
node /path/to/codebase-context/dist/index.js memory list
node /path/to/codebase-context/dist/index.js memory list --query "watcher"

node /path/to/codebase-context/dist/index.js memory add \
  --type gotcha \
  --category tooling \
  --memory "Use pnpm, not npm" \
  --reason "Workspace support and speed"

node /path/to/codebase-context/dist/index.js memory remove <id>
```
