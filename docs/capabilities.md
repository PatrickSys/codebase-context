# Capabilities Reference

Technical reference for what `codebase-context` ships today. For the user-facing overview, see [README.md](../README.md).

## Transport Modes

The server supports two transport modes:

| Mode | Command | MCP endpoint |
| ---- | ------- | ------------ |
| **stdio** (default) | `npx -y codebase-context` | Spawned process stdin/stdout |
| **HTTP** | `npx -y codebase-context --http [--port N]` | `http://127.0.0.1:3100/mcp` |

HTTP defaults to `127.0.0.1:3100`. Override with `--port`, `CODEBASE_CONTEXT_PORT`, or `server.port` in `~/.codebase-context/config.json`.

Config-registered project roots (from `~/.codebase-context/config.json`) are loaded at startup in both modes.

Per-project config overrides supported today:

- `projects[].excludePatterns`: merged with the built-in exclusion set for that project at index time
- `projects[].analyzerHints.analyzer`: prefers a registered analyzer by name for that project and falls back safely when the name is missing or invalid
- `projects[].analyzerHints.extensions`: adds project-local source extensions for indexing and auto-refresh watching without changing defaults for other projects


Copy-pasteable client config templates are shipped in the package:

- `templates/mcp/stdio/.mcp.json` — stdio setup for `.mcp.json`-style clients
- `templates/mcp/http/.mcp.json` — HTTP setup for `.mcp.json`-style clients

Client transport support varies — see [README.md](../README.md) for a per-client matrix covering Claude Code, Cursor, Codex, Windsurf, VS Code, Claude Desktop, and OpenCode.

## CLI Reference

Repo-scoped capabilities are available locally via the CLI (human-readable by default, `--json` for automation).
Multi-project selection is MCP-only because the CLI already targets one root per invocation.
For a command gallery with examples, see `docs/cli.md`.

| Command | Flags | Maps to |
|---|---|---|
| `search --query <q>` | `--intent explore\|edit\|refactor\|migrate`, `--limit <n>`, `--lang <l>`, `--framework <f>`, `--layer <l>` | `search_codebase` |
| `metadata` | — | `get_codebase_metadata` |
| `status` | — | `get_indexing_status` |
| `reindex` | `--incremental`, `--reason <r>` | equivalent to `refresh_index` |
| `style-guide` | `--query <q>`, `--category <c>` | `get_style_guide` |
| `patterns` | `--category all\|di\|state\|testing\|libraries` | `get_team_patterns` |
| `refs --symbol <name>` | `--limit <n>` | `get_symbol_references` |
| `cycles` | `--scope <path>` | `detect_circular_dependencies` |
| `memory list` | `--category`, `--type`, `--query`, `--json` | — |
| `memory add` | `--type`, `--category`, `--memory`, `--reason` | `remember` |
| `memory remove <id>` | — | — |

All commands accept `--json` for raw JSON output. Errors go to stderr with exit code 1.

```bash
# Quick examples
npx codebase-context status
npx codebase-context search --query "auth middleware" --intent edit
npx codebase-context refs --symbol "UserService" --limit 10
npx codebase-context cycles --scope src/features
npx codebase-context reindex --incremental
```

## Tool Surface

10 MCP tools + active/project-scoped context resources.

Shared selector inputs:

- `project` (preferred): project root path, file path, `file://` URI, or relative subproject path under a configured root
- `project_directory` (compatibility alias): deprecated alias for `project`

**Migration:** `get_component_usage` was removed; use `get_symbol_references` for symbol usage evidence.

### Core Tools

| Tool                    | Input                                                             | Output                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_codebase`       | `query`, optional `intent`, `limit`, `filters`, `includeSnippets`, shared `project`/`project_directory` | Ranked results (`file`, `summary`, `score`, `type`, `trend`, `patternWarning`, `relationships`, `hints`) + `searchQuality` + decision card (`ready`, `nextAction`, `patterns`, `bestExample`, `impact`, `whatWouldHelp`) when `intent="edit"`. Hints capped at 3 per category. |
| `get_team_patterns`     | optional `category`, shared `project`/`project_directory`     | Pattern frequencies, trends, golden files, conflicts                                                                                                                                 |
| `get_symbol_references` | `symbol`, optional `limit`, shared `project`/`project_directory` | Concrete symbol usage evidence: `usageCount` + top usage snippets + `confidence` + `isComplete`. `confidence: "syntactic"` means static/source-based only (no runtime or dynamic dispatch). When Tree-sitter + file content are available, comments and string literals are excluded from the scan — the count reflects real identifier nodes only. Replaces the removed `get_component_usage`. |
| `remember`              | `type`, `category`, `memory`, `reason`, shared `project`/`project_directory` | Persists to `.codebase-context/memory.json`                                                                                                                                          |
| `get_memory`            | optional `category`, `type`, `query`, `limit`, shared `project`/`project_directory` | Memories with confidence decay scoring                                                                                                                                               |

### Utility Tools

| Tool                           | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `get_codebase_metadata`        | Framework, dependencies, project stats               |
| `get_style_guide`              | Style rules from project documentation               |
| `detect_circular_dependencies` | Import cycles in the file graph                      |
| `refresh_index`                | Full or incremental re-index + git memory extraction |
| `get_indexing_status`          | Index state, progress, last stats                    |

## Project Routing

Behavior matrix:

| Situation | Server behavior |
| --- | --- |
| One known project | Automatic routing |
| Multiple known projects + active project already set | Automatic routing to the active project |
| Multiple known projects + no active project | `selection_required` |
| No workspace context and no bootstrap path | `selection_required` until the caller passes `project` |

Rules:

- If the client provides workspace context, that becomes the trusted workspace boundary for the session. In practice this usually comes from MCP roots.
- Treat seamless multi-project routing as evidence-backed only for roots-capable hosts. Without roots, explicit fallback is still required.
- If the server still cannot tell which project to use, a bootstrap path or explicit absolute `project` path remains the fallback.
- `project` is the canonical explicit selector when routing is ambiguous.
- `project` may point at a project path, file path, `file://` URI, or relative subproject path.
- Later tool calls may omit `project`; the server falls back to the active project when one has already been established.
- The server does not rely on `cwd` walk-up in MCP mode.
- `codebase://context` serves the active project. Before selection in an unresolved multi-project session, it returns a workspace overview with candidate projects, readiness state, and project-scoped resource URIs.
- `codebase://context/project/<encoded-project-path>` serves a specific project directly and also makes that project active for later tool calls.

### Examples

Retry with a subproject path in a monorepo:

```json
{
  "name": "search_codebase",
  "arguments": {
    "query": "auth interceptor",
    "project": "apps/dashboard"
  }
}
```

Target a repo directly:

```json
{
  "name": "search_codebase",
  "arguments": {
    "query": "auth interceptor",
    "project": "/repos/customer-portal"
  }
}
```

Pass a file path and let the server resolve the nearest project boundary:

```json
{
  "name": "search_codebase",
  "arguments": {
    "query": "auth interceptor",
    "project": "/repos/monorepo/apps/dashboard/src/auth/guard.ts"
  }
}
```

`selection_required` response shape:

```json
{
  "status": "selection_required",
  "errorCode": "selection_required",
  "message": "Multiple projects are available and no active project could be inferred. Retry with project.",
  "nextAction": "retry_with_project",
  "availableProjects": [
    { "label": "app-a", "project": "/repos/app-a", "indexStatus": "idle", "source": "root" },
    { "label": "app-b", "project": "/repos/app-b", "indexStatus": "ready", "source": "root" }
  ]
}
```

Retry the call with `project` set to one of the listed paths.

## Retrieval Pipeline

Ordered by execution:

1. **Intent classification** — EXACT_NAME (for symbols), CONCEPTUAL, FLOW, CONFIG, WIRING. Sets keyword/semantic weight ratio.
2. **Query expansion** — bounded domain term expansion for conceptual queries.
3. **Dual retrieval** — keyword (Fuse.js) + semantic (local embeddings or OpenAI).
4. **RRF fusion** — Reciprocal Rank Fusion (k=60) across all retrieval channels.
5. **Definition-first boost** — for EXACT_NAME intent, results matching the symbol name get +15% score boost (e.g., defining file ranks above using files).
6. **Structure-aware boosting** — import centrality, composition root boost, path overlap, definition demotion for action queries.
7. **Contamination control** — test file filtering for non-test queries.
8. **File deduplication** — best chunk per file.
9. **Symbol-level deduplication** — within each `symbolPath` group, keep only the highest-scoring chunk (prevents duplicate methods from same class clogging results).
10. **Stage-2 reranking** — cross-encoder (`Xenova/ms-marco-MiniLM-L-6-v2`) triggers when the score between the top files are very close. CPU-only, top-10 bounded.
11. **Result enrichment** — compact type (`componentType:layer`), pattern momentum (`trend` Rising/Declining only, Stable omitted), `patternWarning`, condensed relationships (`importedByCount`/`hasTests`), structured hints (capped callers/consumers/tests ranked by frequency), scope header for symbol-aware snippets (`// ClassName.methodName`), related memories (capped to 3), search quality assessment with `hint` when low confidence.

### Defaults

- **Chunk size**: 50 lines, 0 overlap
- **Reranker trigger**: activates when top-3 results are within 0.08 score of each other
- **Embedding model**: `Xenova/bge-small-en-v1.5` (512 token context, fast, local-first) via `@huggingface/transformers`. Override: `EMBEDDING_MODEL=onnx-community/granite-embedding-small-english-r2-ONNX` for Granite (8192 ctx, slower).
- **Vector DB**: LanceDB with cosine distance

## Decision Card (Edit Intent)

Returned as `preflight` when search `intent` is `edit`, `refactor`, or `migrate`.

**Output shape:**

```typescript
{
  ready: boolean;
  nextAction?: string;        // Only when ready=false; what to search for next
  warnings?: string[];        // Failure memories (capped at 3)
  patterns?: {
    do: string[];             // Top 3 preferred patterns with adoption %
    avoid: string[];          // Top 3 declining patterns
  };
  bestExample?: string;       // Top 1 golden file (path format)
  impact?: {
    coverage?: string;        // "X/Y callers in results"
    files?: string[];         // Back-compat: top impact candidates (paths only)
    details?: Array<{ file: string; line?: number; hop: 1 | 2 }>; // When available
  };
  whatWouldHelp?: string[];   // Concrete next steps (max 4) when ready=false
}
```

Impact is 2-hop transitive: direct importers (hop 1) and their importers (hop 2), each labeled with distance. Capped at 20 files to avoid noise.

**Fields explained:**

- `ready`: boolean, whether evidence is sufficient to proceed
- `nextAction`: actionable reason why `ready=false` (e.g., "2 of 5 callers missing")
- `warnings`: failure memories from team (auto-surfaces past mistakes)
- `patterns.do`: patterns the team is adopting, ranked by adoption %
- `patterns.avoid`: declining patterns, ranked by % (useful for migrations)
- `bestExample`: exemplar file for the area under edit
- `impact.coverage`: shows caller visibility ("3/5 callers in results" means 2 callers weren't searched yet)
- `impact.details`: richer impact candidates with optional `line` and hop distance (1 = direct, 2 = transitive)
- `impact.files`: back-compat list of impact candidate paths (when details aren’t available)
- `whatWouldHelp`: specific next searches, tool calls, or files to check that would close evidence gaps

### How `ready` is determined

1. **Evidence triangulation** — scores code match (45%), pattern alignment (30%), and memory support (25%). Needs combined score ≥ 40 to pass.
2. **Epistemic stress check** — if pattern conflicts, stale memories, thin evidence, or low caller coverage are detected, `ready` is set to false.
3. **Search quality gate** — if `searchQuality.status` is `low_confidence`, `ready` is forced to false regardless of evidence scores. This prevents the "confidently wrong" problem.

### Internal signals (not in output, feed `ready` computation)

- Risk level from circular deps, impact breadth, and failure memories
- Preferred/avoid patterns from team pattern analysis
- Golden files ranked by pattern density
- Caller coverage from import graph (X of Y callers appearing in results)
- Pattern conflicts when two patterns in the same category are both > 20% adoption
- Confidence decay of related memories

## Memory System

- 4 types: `convention`, `decision`, `gotcha`, `failure`
- Confidence decay: conventions never decay, decisions 180-day half-life, gotchas/failures 90-day half-life
- Stale threshold: memories below 30% confidence are flagged
- Git auto-extraction: conventional commits from last 90 days
- Surface locations: `search_codebase` results (as `relatedMemories`), `get_team_patterns` responses, preflight analysis

## Indexing

- Initial: full scan → chunking (50 lines, 0 overlap) → embedding → vector DB (LanceDB) + keyword index (Fuse.js)
- Incremental: SHA-256 manifest diffing, selective embed/delete, full intelligence regeneration
- Auto-refresh (MCP server mode only): chokidar file watcher triggers incremental reindex after a debounce on any source file change — `node_modules/`, `.git/`, `dist/`, and `.codebase-context/` are excluded. One-shot CLI runs skip the watcher entirely.
- Version gating: `index-meta.json` tracks format version; mismatches trigger automatic rebuild
- Crash-safe rebuilds: full rebuilds write to `.staging/` and swap atomically only on success
- Auto-heal: corrupted index triggers automatic full re-index on next search
- Relationships sidecar: `relationships.json` contains file import graph, symbol export index, and per-edge import details (`importDetails`: line number + imported symbol names where available)
- Storage: `.codebase-context/` directory (memory.json + generated files)

## Analyzers

- **Angular**: signals, standalone components, control flow syntax, lifecycle hooks, DI patterns, component metadata
- **React**: function/class components, custom hooks, context usage, memoization, Suspense, ecosystem signal extraction
- **Next.js**: App Router and Pages Router detection, route/API classification, route paths, `"use client"`, metadata exports
- **Generic**: 30+ have indexing/retrieval coverage including PHP, Ruby, Swift, Scala, Shell, config/markup., 10 languages have full symbol extraction (Tree-sitter: TypeScript, JavaScript, Python, Java, Kotlin, C, C++, C#, Go, Rust). 

Notes:

- Language detection covers common extensions including `.pyi`, `.kt`/`.kts`, `.cc`/`.cxx`, and config formats like `.toml`/`.xml`.
- When Tree-sitter grammars are present, the Generic analyzer uses AST-aligned chunking and scope-aware prefixes for symbol-aware snippets (with fallbacks).

## Evaluation Harness

Reproducible evaluation is shipped as a CLI entrypoint backed by shared scoring/reporting code.

- **Command:** `npm run eval -- <codebaseA> [codebaseB] --mode retrieval|discovery [--competitor-results <path>]` (builds first, then runs `scripts/run-eval.mjs`)
- **Shared implementation:** `src/eval/harness.ts`, `src/eval/discovery-harness.ts`, and `src/eval/types.ts`
- **Frozen retrieval fixtures:**
  - `tests/fixtures/eval-angular-spotify.json`
  - `tests/fixtures/eval-controlled.json` + `tests/fixtures/codebases/eval-controlled/`
- **Frozen discovery fixtures:**
  - `tests/fixtures/discovery-angular-spotify.json`
  - `tests/fixtures/discovery-excalidraw.json`
  - `tests/fixtures/discovery-benchmark-protocol.json`
- **Retrieval metrics:** Top-1 accuracy, Top-3 recall, spec contamination rate, and a gate pass/fail
- **Discovery metrics:** usefulness score, payload bytes, estimated tokens, first relevant hit, and best-example usefulness
- **Discovery gate:** discovery mode evaluates the frozen ship gate only when the full public suite and comparator metrics are available; missing comparator evidence is reported as pending, not silently treated as pass/fail
- **Limits:** discovery mode is discovery-only, uses current shipped surfaces only, and does not claim implementation quality; named competitor runs remain a documented hybrid/manual lane rather than a built-in automated benchmark

## Limitations

- **Symbol refs are not a call-graph.** `get_symbol_references` counts identifier-node occurrences in the AST (comments/strings excluded via Tree-sitter). It does not distinguish call sites from type annotations, variable assignments, or imports. Full call-site-specific analysis (`call_expression` nodes only) is a roadmap item.
- **Impact is 2-hop max.** `computeImpactCandidates` walks direct importers then their importers. Full BFS reachability is on the roadmap.
- **Angular, React, and Next.js have dedicated analyzers.** All other languages go through the Generic analyzer (30+ languages, chunking + import graph, no framework-specific signal extraction).
- **Default embedding model is `bge-small-en-v1.5` (512-token context).** Granite (8192 context) is opt-in via `EMBEDDING_MODEL`. OpenAI is opt-in via `EMBEDDING_PROVIDER=openai` — sends code externally.
- **Patterns are file-level frequency counts.** Not semantic clustering. Rising/Declining trend is derived from git commit recency for files using each pattern, not from usage semantics.
