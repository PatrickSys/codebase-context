# Capabilities Reference

This reference describes the unpublished source candidate (Node.js 22+). The npm release checked on 3 November 2026 is `2.2.0`; unpinned npx commands select that registry package, not the local candidate. Use a built checkout or installed local tarball for the candidate commands below.

Start with the repository map, then search for relevant code. For an overview, see [README.md](../README.md). Candidate functionality is not implied by the current registry version.

## Transport Modes

The server supports two transport modes:

| Mode                | Command                                           | MCP endpoint                 |
| ------------------- | ------------------------------------------------- | ---------------------------- |
| **stdio** (default) | `node /path/to/codebase-context/dist/index.js`                   | Spawned process stdin/stdout |
| **HTTP**            | `node /path/to/codebase-context/dist/index.js --http [--port N]` | `http://127.0.0.1:3100/mcp`  |

HTTP defaults to `127.0.0.1:3100`. Override with `--port`, `CODEBASE_CONTEXT_PORT`, or `server.port` in `~/.codebase-context/config.json`.

Config-registered project roots (from `~/.codebase-context/config.json`) are loaded at startup in both modes.

Per-project config overrides in the candidate:

- `projects[].excludePatterns`: merged with the built-in exclusion set for that project at index time
- `projects[].analyzerHints.analyzer`: prefers a registered analyzer by name for that project and falls back safely when the name is missing or invalid
- `projects[].analyzerHints.extensions`: adds project-local source extensions for indexing and auto-refresh watching without changing defaults for other projects
- `projects[].parsing.maxChunks`: sets the maximum number of searchable chunks indexed for that project (default 5000; configurable via `~/.codebase-context/config.json`)

Copy-pasteable client config templates are shipped in the package:

- `templates/mcp/stdio/.mcp.json` — stdio setup for `.mcp.json`-style clients
- `templates/mcp/http/.mcp.json` — HTTP setup for `.mcp.json`-style clients

Use Node.js 22 or newer with the commands shown here. For setup commands and what was checked, see the [client setup guide](./client-setup.md).

## CLI Reference

Repo-scoped capabilities are available locally via the CLI (human-readable by default, `--json` for automation).
Multi-project selection is MCP-only because the CLI already targets one root per invocation.
For a command gallery with examples, see `docs/cli.md`.

| Command                | Flags                                                                                                      | Maps to                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `map`                  | `--json`, `--pretty`                                                                                       | `codebase://context` (conventions map) |
| `search --query <q>`   | `--intent explore\|edit\|refactor\|migrate`, `--limit <n>`, `--lang <l>`, `--framework <f>`, `--layer <l>` | `search_codebase`                      |
| `metadata`             | —                                                                                                          | `get_codebase_metadata`                |
| `status`               | —                                                                                                          | `get_indexing_status`                  |
| `reindex`              | `--incremental`, `--reason <r>`                                                                            | equivalent to `refresh_index`          |
| `style-guide`          | `--query <q>`, `--category <c>`                                                                            | `get_style_guide`                      |
| `patterns`             | `--category all\|di\|state\|testing\|libraries`                                                            | `get_team_patterns`                    |
| `refs --symbol <name>` | `--limit <n>`                                                                                              | `get_symbol_references`                |
| `cycles`               | `--scope <path>`                                                                                           | `detect_circular_dependencies`         |
| `memory list`          | `--category`, `--type`, `--query`, `--json`                                                                | —                                      |
| `memory add`           | `--type`, `--category`, `--memory`, `--reason`                                                             | `remember`                             |
| `memory remove <id>`   | —                                                                                                          | —                                      |

Commands that list `--json` above support raw JSON output. Follow the [client setup guide](./client-setup.md) to connect your client. The candidate `init` command detects Claude Code, Codex, Cursor and OpenCode and writes selected project registrations; registration alone does not establish native-client task completion. Errors go to stderr with exit code 1.

```bash
# Quick examples
node /path/to/codebase-context/dist/index.js status
node /path/to/codebase-context/dist/index.js search --query "auth middleware" --intent edit
node /path/to/codebase-context/dist/index.js refs --symbol "UserService" --limit 10
node /path/to/codebase-context/dist/index.js cycles --scope src/features
node /path/to/codebase-context/dist/index.js reindex --incremental
```

## Tool Surface

MCP tools plus active/project-scoped context resources are listed below.

Shared selector inputs:

- `project` (preferred): project root path, file path, `file://` URI, or relative subproject path under a configured root
- `project_directory` (compatibility alias): deprecated alias for `project`

**Migration:** `get_component_usage` was removed; use `get_symbol_references` for symbol usage evidence.

### Core Tools

| Tool                    | Input                                                                                                   | Output                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_codebase`       | `query`, optional `intent`, `limit`, `filters`, `includeSnippets`, shared `project`/`project_directory` | Compact mode returns a bounded result set with `file`, `summary`, `score`, lightweight structural metadata (`symbol`, `symbolKind`, `scope`, `signaturePreview`), and `searchQuality` (`status`, `confidence`, optional `hint`, `tokenEstimate`, `warning`, `rerankerStatus`). Full mode adds richer relationships plus chunk-level `imports`, `exports`, and `complexity`. When `intent="edit"`, a decision card is returned with `ready`, `patterns`, `bestExample`, `impact`, and `whatWouldHelp`. |
| `get_team_patterns`     | optional `category`, shared `project`/`project_directory`                                               | Pattern frequencies, trends, golden files, conflicts                                                                                                                                                                                                                                                                                                                                            |
| `get_symbol_references` | `symbol`, optional `limit`, shared `project`/`project_directory`                                        | Concrete symbol usage evidence: `usageCount` + top usage snippets + `confidence` + `isComplete`. `confidence: "syntactic"` means static/source-based only (no runtime or dynamic dispatch). When Tree-sitter + file content are available, comments and string literals are excluded from the scan — the count reflects real identifier nodes only. Replaces the removed `get_component_usage`. |
| `remember`              | `type`, `category`, `memory`, `reason`, shared `project`/`project_directory`                            | Persists to `.codebase-context/memory.json`                                                                                                                                                                                                                                                                                                                                                     |
| `get_memory`            | optional `category`, `type`, `query`, `limit`, shared `project`/`project_directory`                     | Memories with confidence decay scoring                                                                                                                                                                                                                                                                                                                                                          |

### Utility Tools

| Tool                           | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `get_codebase_metadata`        | Framework, dependencies, project stats               |
| `get_style_guide`              | Style rules from project documentation               |
| `detect_circular_dependencies` | Import cycles in the file graph                      |
| `refresh_index`                | Full or incremental re-index + git memory extraction |
| `get_indexing_status`          | Index state, progress, last stats                    |

### File navigation in the unreleased candidate

`get_code_relationships` follows verified TypeScript/JavaScript file imports and re-exports. Supply `file`, optional `direction` (`outgoing` or `incoming`), `max_hops` (1 to 3, default 2) and `max_nodes` (1 to 100, default 50). It checks current source snapshots and reports stale or unresolved edges. Python and Go import navigation are not supported.

## Project Routing

Behavior matrix:

| Situation                                            | Server behavior                                        |
| ---------------------------------------------------- | ------------------------------------------------------ |
| One known project                                    | Automatic routing                                      |
| Multiple known projects + active project already set | Automatic routing to the active project                |
| Multiple known projects + no active project          | `selection_required`                                   |
| No workspace context and no bootstrap path           | `selection_required` until the caller passes `project` |

Rules:

- The portable default is explicit selection: pass the repository's absolute path as `project`. A successful selection becomes the active project for that server process.
- Client-announced workspace roots remain a compatibility aid and constrain explicit selectors to that workspace. One valid root can auto-select; ambiguous roots require selection. Roots are not required for the documented setup.
- Without a configured folder, known root or active selection, the server returns `selection_required` instead of guessing a project.
- `project` may point at a project path, file path, `file://` URI, or relative subproject path.
- Later tool calls may omit `project`; the server falls back to the active project when one has already been established.
- Select again after a server restart or when changing repositories. Published-package A/B/A stdio routing was verified; it does not establish native agent continuation or concurrent HTTP isolation. See the [client setup guide](./client-setup.md#project-routing-contract) for the checks and their limits.
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

Fresh indexes use the keyword path. Existing indexes retain their recorded mode. The semantic channel and cross-encoder reranker are disabled for keyword-only indexes. The stages below describe available implementation paths; they do not establish retrieval quality or run unconditionally:

1. **Intent classification** — EXACT_NAME (for symbols), CONCEPTUAL, FLOW, CONFIG, WIRING. Sets keyword/semantic weight ratio.
2. **Query expansion** — bounded domain term expansion for conceptual queries.
3. **Retrieval** — keyword (Fuse.js) by default; an embeddings-enabled index can also use its configured local or remote semantic provider.
4. **RRF fusion** — Reciprocal Rank Fusion (k=60) across enabled retrieval channels.
5. **Definition-first boost** — for EXACT_NAME intent, results matching the symbol name get +15% score boost (a ranking signal, not a guarantee that a definition ranks first).
6. **Structure-aware boosting** — import centrality, composition root boost, path overlap, definition demotion for action queries.
7. **Contamination control** — test file filtering for non-test queries.
8. **File deduplication** — best chunk per file.
9. **Symbol-level deduplication** — within each `symbolPath` group, keep only the highest-scoring chunk (prevents duplicate methods from same class clogging results).
10. **Optional stage-2 reranking** — on an embeddings-enabled path, the cross-encoder (`Xenova/ms-marco-MiniLM-L-6-v2`) triggers when the score between the top files are very close. CPU-only, top-10 bounded.
11. **Result enrichment** — compact type (`componentType:layer`), pattern momentum (`trend` Rising/Declining only, Stable omitted), `patternWarning`, condensed relationships (`importedByCount`/`hasTests`), structured hints (capped callers/consumers/tests ranked by frequency), scope header for symbol-aware snippets (`// ClassName.methodName`), related memories (capped to 3), search quality assessment with `hint` when low confidence.
12. **Payload budgeting** — final serialized search responses include `searchQuality.tokenEstimate`; warnings only appear above the 4K-token threshold and differ between compact and full mode.
13. **Full-mode chunk metadata** — when available, full-mode results surface chunk-level `imports` (top 5), `exports` (top 5), and cyclomatic `complexity`.

### Defaults in the unreleased candidate

- **Chunk size**: 50 lines, 0 overlap
- **Reranker trigger when enabled**: top-3 results within 0.08 score of each other; disabled for keyword-only indexes
- **Embedding mode**: new indexes are model-free. Existing indexes keep their recorded mode unless explicitly changed. `reindex --embeddings` opts into semantic indexing with the configured provider. LanceDB is required; the default local provider also requires Transformers.
- **Default local semantic model when enabled**: `Xenova/bge-small-en-v1.5` (512 token context) via `@huggingface/transformers`. Override: `EMBEDDING_MODEL=onnx-community/granite-embedding-small-english-r2-ONNX` for Granite (8192 token context).
- **Vector DB when embeddings are enabled**: LanceDB with cosine distance

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
3. **Search quality gate** — if `searchQuality.status` is `low_confidence`, `ready` is forced to false regardless of evidence scores. This exposes weak retrieval evidence; it does not establish that a returned answer or proposed edit is correct.

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

## Indexing in the unreleased candidate

- Initial: full scan → chunking (50 lines, 0 overlap) → keyword index (Fuse.js). Explicit semantic mode also creates embeddings and a LanceDB vector index.
- Incremental: SHA-256 manifest diffing, selective embed/delete, full intelligence regeneration
- Auto-refresh (MCP server mode only): chokidar file watcher triggers incremental reindex after a debounce on any source file change — `node_modules/`, `.git/`, `dist/`, and `.codebase-context/` are excluded. One-shot CLI runs skip the watcher entirely.
- Version gating: `index-meta.json` tracks format version; older format-4 caches require a full rebuild in their recorded mode before use with format 5. Unknown mode or occupied recovery slots can require explicit recovery.
- Publication: full and incremental builds write complete `.generations/<buildId>/` directories, close vector handles, then replace the authoritative `index-meta.json`. Readers select a committed generation. Interrupted or failed work can require explicit recovery; publication and cleanup outcomes must be checked separately.
- Producer integrity: chunks must belong to the analyzed file and contain real source from their claimed interval. Independent, overlapping or disjoint component spans remain separate. Invalid producer output aborts that publication; reader source/range checks remain strict.
- Search evidence: the source manifest must match the pinned build. Each nominated chunk's full body is checked against its current source interval before it can produce a result; a forged stored prefix is corruption and triggers rebuild rather than being stripped. Valid context metadata stays separate from the exact source snippet. These bounded candidate checks do not audit every stored chunk, and describe source state when checked.
- Relationship freshness: unresolved specifiers are checked again with the current TypeScript/JavaScript resolver. A newly available target is reported as stale until refresh records a verified edge; unchanged importer bytes alone do not prove unchanged resolution.
- Recovery status: a late auto-heal result carries its current index state instead of a preflight ready signal. Failed launches report an error; wait for a confirmed ready state before retrying.
- Retention: at most three retained or in-progress generations, counting legacy fixed files. A refresh is deferred when live readers occupy the available slots. Cleanup failures do not roll back a committed build.
- Recovery: missing root metadata does not make surviving generations a fresh index. Completed or unknown generations are preserved; automatic map/default reindex requires explicit recovery. If all three slots are occupied, first copy and verify the generation you choose to a recovery location outside `.codebase-context` (for example `E:/cbc-index-recovery/my-project/<buildId>`), then relocate that selected directory out of `.generations` and retry `reindex --embeddings` or `reindex --no-embeddings` with the intended mode. The program does not select a generation for you; mode flags do not override the capacity limit.
- Refresh search: searches can use the previous complete build while a refresh runs, but exclude evidence whose source changed. An initial build still reports `indexing`.
- Auto-heal: search can request a rebuild when index validation fails. Check the reported state and error; scheduling a rebuild is not proof that recovery completed.
- Relationships sidecar: `relationships.json` contains file import graph, symbol export index, and per-edge import details (`importDetails`: line number + imported symbol names where available)
- Storage: `.codebase-context/` directory (memory.json + generated files)

## Analyzers

- **Angular**: signals, standalone components, control flow syntax, lifecycle hooks, DI patterns, component metadata
- **React**: function/class components, custom hooks, context usage, memoization, Suspense, ecosystem signal extraction
- **Next.js**: App Router and Pages Router detection, route/API classification, route paths, `"use client"`, metadata exports
- **NestJS** (unpublished source candidate): modules, controllers, providers and route handlers, contributed by Aaron Olin. Matching NestJS source is detected automatically.
- **Generic**: other source and text files use the generic analyzer. AST and symbol support depend on the available language grammar; fallback indexing is not proof of equivalent symbol or retrieval support across languages.

Notes:

- Language detection covers common extensions including `.pyi`, `.kt`/`.kts`, `.cc`/`.cxx`, and config formats like `.toml`/`.xml`.
- When Tree-sitter grammars are present, the Generic analyzer uses AST-aligned chunking and scope-aware prefixes for symbol-aware snippets (with fallbacks).

## Evaluation Harness

Historical public evidence: [benchmark](https://github.com/PatrickSys/codebase-context/blob/master/docs/benchmark.md) and [comparison table](https://github.com/PatrickSys/codebase-context/blob/master/docs/comparison-table.md). These reports do not certify the current candidate.

The source checkout contains an evaluation entrypoint backed by shared scoring and reporting code. Its scripts and fixtures are not included in the npm tarball.

- **Command:** `pnpm run eval -- <codebaseA> [codebaseB] --mode retrieval|discovery [--competitor-results <path>]` (builds first, then runs `scripts/run-eval.mjs`)
- **Contributor requirement:** this repository command uses the pinned `pnpm@10.27.0`; end users do not need pnpm for the `npx` CLI.
- **Shared implementation:** `src/eval/harness.ts`, `src/eval/discovery-harness.ts`, and `src/eval/types.ts`
- **Retrieval fixtures:** `tests/fixtures/eval-angular-spotify.json` and `tests/fixtures/eval-controlled.json` with `tests/fixtures/codebases/eval-controlled/`
- **Discovery fixtures:** `tests/fixtures/discovery-angular-spotify.json`, `tests/fixtures/discovery-excalidraw.json`, and `tests/fixtures/discovery-benchmark-protocol.json`
- **Retrieval metrics:** Top-1 accuracy, Top-3 recall, spec contamination rate, and a pass/fail result for the configured retrieval check
- **Discovery metrics:** usefulness score, payload bytes, estimated tokens, first relevant hit, and best-example usefulness
- **Public benchmark families:** the current documentation keeps 100 corrected retrieval attempts, 300 repeated retrieval attempts, 30 full-agent pilot attempts, and 100 invalid-token replays separate across five local code-context tools
- **Discovery limits:** discovery mode describes the shipped discovery surface and does not measure patch correctness or end-to-end task completion; named competitor runs remain a documented hybrid/manual lane rather than a built-in automated benchmark
- **Evidence limits:** missing or failed setup and comparator runs remain visible in their source artifacts and are not treated as a pass

## Limitations

- **Default retrieval is keyword-only.** Natural-language questions can miss implementations when query vocabulary differs from source. Low confidence does not prove absence. No candidate retrieval-quality advantage over text search or optional embeddings has been established.
- **Compact search output is capped at six results.** The CLI uses that mode; a larger requested limit does not remove its output cap. MCP callers can request `mode="full"`, still subject to response budgeting.
- **Status describes a generation.** Persisted counts and timestamps are used together; in-memory run details are included only for the matching build.

- **Symbol refs are not a call-graph.** `get_symbol_references` counts identifier-node occurrences in the AST (comments/strings excluded via Tree-sitter). It does not distinguish call sites from type annotations, variable assignments, or imports. Full call-site-specific analysis (`call_expression` nodes only) is a roadmap item.
- **Impact is 2-hop max.** `computeImpactCandidates` walks direct importers then their importers. Full BFS reachability is on the roadmap.
- **Publication boundary:** the source candidate includes a NestJS analyzer and changes to React/Next.js detection and reranker behavior. The dated npm 2.2.0 documentation describes the older Angular, React and Next.js analyzers. These source changes do not imply a published release or measured retrieval improvement. Other languages use the Generic analyzer for indexing and retrieval; available symbol extraction depends on parser support. File import resolution and multi-hop navigation currently support TypeScript and JavaScript. Python and Go import navigation are not supported.
- **The unreleased candidate defaults new indexes to model-free mode. Published 2.2.0 enables embeddings by default.** When semantic mode is enabled, its default model is `bge-small-en-v1.5` (512-token context). Granite (8192 context) is opt-in via `EMBEDDING_MODEL`. OpenAI is opt-in via `EMBEDDING_PROVIDER=openai` with `OPENAI_API_KEY`; use `OPENAI_BASE_URL` for OpenAI-compatible endpoints (Ollama, LiteLLM, proxies) instead of `https://api.openai.com/v1`.
- **Patterns are file-level frequency counts.** Not semantic clustering. Rising/Declining trend is derived from git commit recency for files using each pattern, not from usage semantics.
