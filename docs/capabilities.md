# Capabilities Reference

Technical reference for this source tree. The relaunch changes below are an unreleased candidate, distinct from published npm `2.2.0`. The bounded conventions map and source search provide local navigation; useful engineering still requires opening current source and checking behavior. For setup and version boundaries, see [README.md](../README.md).

## Candidate source navigation

`get_code_relationships` accepts an indexed repository-relative `file`, `direction` (`outgoing` or `incoming`), `max_hops` (1-3, default 2), and `max_nodes` (1-100, default 50), plus the shared project selector. Directed paths distinguish imports from re-exports and cite importer lines/specifiers. Current module resolution, both source fingerprints, and realpath confinement are checked before a path is returned. Unresolved specifiers are diagnostics; legacy proofless or changed edges are omitted with refresh guidance. The returned JSON text, including project-routing metadata, is capped at 4,000 UTF-8 bytes; this excludes the MCP transport envelope. Truncation is explicit, and dense neighborhoods may require following a returned file in another call to see a full three-hop chain.

TypeScript configuration/module resolution supports applicable relative paths, aliases, and config inheritance. Workspace package exports, missing sparse-checkout files, dynamic imports/calls, and language-specific resolution can remain unresolved. Three hops do not establish runtime calls, inheritance, or complete program reachability. Existing search decision-card impact remains at two hops.

Search snippets and symbol references read confined current files. Search checks indexed source snapshots and ranges; a changed, deleted, or unreadable candidate requires refresh instead of returning cached text as current evidence. Compact search results offer a current source read and the relationship tool as next steps. Scores and readiness signals are heuristics, not proof that a result answers the question.

Newly written chunk paths are relative to the selected project root, independent of the caller's working directory. An existing index created with incorrect working-directory-relative paths may require a full `reindex`; an unchanged incremental run does not migrate those artifacts.

## Transport Modes

The server supports two transport modes:

| Mode                | Command                                           | MCP endpoint                 |
| ------------------- | ------------------------------------------------- | ---------------------------- |
| **stdio** (default) | `npx -y codebase-context@2.2.0`                   | Spawned process stdin/stdout |
| **HTTP**            | `npx -y codebase-context@2.2.0 --http [--port N]` | `http://127.0.0.1:3100/mcp`  |

HTTP defaults to `127.0.0.1:3100`. Override with `--port`, `CODEBASE_CONTEXT_PORT`, or `server.port` in `~/.codebase-context/config.json`.

Config-registered project roots (from `~/.codebase-context/config.json`) are loaded at startup in both modes.

Per-project config overrides supported today:

- `projects[].excludePatterns`: merged with the built-in exclusion set for that project at index time
- `projects[].analyzerHints.analyzer`: prefers a registered analyzer by name for that project and falls back safely when the name is missing or invalid
- `projects[].analyzerHints.extensions`: adds project-local source extensions for indexing and auto-refresh watching without changing defaults for other projects

Copy-pasteable client config templates are shipped in the package:

- `templates/mcp/stdio/.mcp.json` — stdio setup for `.mcp.json`-style clients
- `templates/mcp/http/.mcp.json` — HTTP setup for `.mcp.json`-style clients

Use Node.js 22 or newer with the published 2.2.0 commands shown here. For client registration recipes and their verification limits, see the [client setup guide](./client-setup.md).

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
| `reindex`              | `--incremental`, `--reason <r>`, candidate-only `--embeddings` / `--no-embeddings`                         | equivalent to `refresh_index`          |
| `style-guide`          | `--query <q>`, `--category <c>`                                                                            | `get_style_guide`                      |
| `patterns`             | `--category all\|di\|state\|testing\|libraries`                                                            | `get_team_patterns`                    |
| `refs --symbol <name>` | `--limit <n>`                                                                                              | `get_symbol_references`                |
| `cycles`               | `--scope <path>`                                                                                           | `detect_circular_dependencies`         |
| `memory list`          | `--category`, `--type`, `--query`, `--json`                                                                | —                                      |
| `memory add`           | `--type`, `--category`, `--memory`, `--reason`                                                             | `remember`                             |
| `memory remove <id>`   | —                                                                                                          | —                                      |

Commands that list `--json` above support raw JSON output. For MCP client registration, follow the [published client setup recipes](./client-setup.md); do not use the broken `init` setup command in published 2.2.0. Errors go to stderr with exit code 1.

The unreleased source installer defaults Codex to a user-level rootless STDIO registration, shared across repositories. It does not index a repository during user setup. `--scope project` or `--root <directory>` retains project-only configuration and index preparation. Both scopes preserve unrelated settings and host trust/approval controls. Project selection remains the existing MCP `project`/roots/session contract; setup does not infer a repository from the package location.

```bash
# Quick examples
npx -y codebase-context@2.2.0 status
npx -y codebase-context@2.2.0 search --query "auth middleware" --intent edit
npx -y codebase-context@2.2.0 refs --symbol "UserService" --limit 10
npx -y codebase-context@2.2.0 cycles --scope src/features
npx -y codebase-context@2.2.0 reindex --incremental
```

## Tool Surface

12 MCP tools + active/project-scoped context resources.

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
| `get_codebase_health`          | Highest-risk indexed files and health reasons; optionally one file |
| `get_code_relationships`        | Verified directed import/re-export paths with source citations and freshness diagnostics |

The `--embeddings` and `--no-embeddings` reindex flags, including how omitted mode flags preserve the project's successful mode, are candidate-only; see the [CLI reindex guide](./cli.md#reindex). Published `2.2.0` examples above do not include these flags.

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

Ordered by execution:

1. **Intent classification** — EXACT_NAME (for symbols), CONCEPTUAL, FLOW, CONFIG, WIRING. Sets keyword/semantic weight ratio.
2. **Query expansion** — bounded domain term expansion for conceptual queries.
3. **Retrieval** — keyword (Fuse.js) by default for new indexes; semantic retrieval joins it only for an embedding-enabled index.
4. **RRF fusion** — Reciprocal Rank Fusion (k=60) across all retrieval channels.
5. **Definition-first boost** — for EXACT_NAME intent, results matching the symbol name get +15% score boost (e.g., defining file ranks above using files).
6. **Structure-aware boosting** — import centrality, composition root boost, path overlap, definition demotion for action queries.
7. **Contamination control** — test file filtering for non-test queries.
8. **File deduplication** — best chunk per file.
9. **Symbol-level deduplication** — within each `symbolPath` group, keep only the highest-scoring chunk (prevents duplicate methods from same class clogging results).
10. **Optional stage-2 reranking** — for embedding-enabled indexes, a cross-encoder (`Xenova/ms-marco-MiniLM-L-6-v2`) can trigger when top scores are close. Model-free indexes skip it. CPU-only, top-10 bounded.
11. **Result enrichment** — compact type (`componentType:layer`), pattern momentum (`trend` Rising/Declining only, Stable omitted), `patternWarning`, condensed relationships (`importedByCount`/`hasTests`), structured hints (capped callers/consumers/tests ranked by frequency), scope header for symbol-aware snippets (`// ClassName.methodName`), related memories (capped to 3), search quality assessment with `hint` when low confidence.
12. **Payload budgeting** — final serialized search responses include `searchQuality.tokenEstimate`; warnings only appear above the 4K-token threshold and differ between compact and full mode.
13. **Full-mode chunk metadata** — when available, full-mode results surface chunk-level `imports` (top 5), `exports` (top 5), and cyclomatic `complexity`.

### Defaults

- **Chunk size**: 50 lines, 0 overlap
- **New projects**: model-free; no embedding/reranker initialization. Existing valid indexes preserve their successful mode.
- **Opt-in**: CLI `reindex --embeddings` or MCP `refresh_index` with `skipEmbedding:false`; `--no-embeddings`/`skipEmbedding:true` select model-free. Mode switches rebuild fully. Explicit startup/config choices are enforced before search.
- **Optional semantic runtimes**: `@huggingface/transformers` and `@lancedb/lancedb` are optional peers, not default install dependencies. Missing runtimes fail before index replacement.
- **Semantic model**: `Xenova/bge-small-en-v1.5` (512 token context); model overrides apply only in semantic mode. Semantic storage uses LanceDB with cosine distance.

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

- Initial: full scan → chunking → keyword/symbol/structural artifacts; embeddings and LanceDB are optional semantic additions.
- Incremental: source-hash diffing, selective update/delete, full intelligence regeneration; drift during analysis fails closed instead of endorsing older analyzed bytes with newer hashes.
- Auto-refresh (MCP server mode only): chokidar file watcher triggers incremental reindex after a debounce on any source file change — `node_modules/`, `.git/`, `dist/`, and `.codebase-context/` are excluded. One-shot CLI runs skip the watcher entirely.
- Version gating: `index-meta.json` tracks format version; mismatches trigger automatic rebuild
- Crash-safe rebuilds: full rebuilds write to `.staging/` and swap atomically only on success
- Auto-heal: corrupted index triggers automatic full re-index on next search
- Relationships sidecar: `relationships.json` contains the file import graph, symbol export index, typed import/re-export source citations and endpoint fingerprints. The query checks current resolution and source before following stored edges.
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

Current public evidence: [`docs/benchmark.md`](../docs/benchmark.md) and [`docs/comparison-table.md`](../docs/comparison-table.md).

Reproducible evaluation is shipped as a CLI entrypoint backed by shared scoring and reporting code.

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

- **Symbol refs are not a call-graph.** `get_symbol_references` counts identifier-node occurrences in the AST (comments/strings excluded via Tree-sitter). It does not distinguish call sites from type annotations, variable assignments, or imports. Full call-site-specific analysis (`call_expression` nodes only) is a roadmap item.
- **Decision-card impact is 2-hop max.** The separate relationship tool follows verified imports/re-exports up to three hops; neither establishes a runtime call graph.
- **Published 2.2.0 has dedicated Angular, React, and Next.js analyzers.** NestJS support is in a newer source candidate and is not part of published 2.2.0. Other languages use the Generic analyzer (30+ languages, chunking + import graph, no framework-specific signal extraction).
- **Model-free conceptual search has limits.** Keyword/symbol matches can miss meaning or return an unrelated high-scoring file. Follow current source and relationship evidence; no general retrieval-quality improvement is claimed. Embeddings are explicit opt-in. OpenAI additionally requires an opt-in provider/key and sends code externally.
- **Patterns are file-level frequency counts.** Not semantic clustering. Rising/Declining trend is derived from git commit recency for files using each pattern, not from usage semantics.
