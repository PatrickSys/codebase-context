# Capabilities Reference

Technical reference for what `codebase-context` ships today. The public product posture is map first, find second: the bounded conventions map is the first-call surface, and search narrows to the right local example after that. For the user-facing overview, see [README.md](../README.md).

## Transport Modes

The server supports two transport modes:

| Mode                | Command                                     | MCP endpoint                 |
| ------------------- | ------------------------------------------- | ---------------------------- |
| **stdio** (default) | `npx -y codebase-context`                   | Spawned process stdin/stdout |
| **HTTP**            | `npx -y codebase-context --http [--port N]` | `http://127.0.0.1:3100/mcp`  |

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

12 MCP tools + active/project-scoped context resources.

Shared selector inputs:

- `project` (preferred): project root path, file path, `file://` URI, or relative subproject path under a configured root
- `project_directory` (compatibility alias): deprecated alias for `project`

**Migration:** `get_component_usage` was removed; use `get_symbol_references` for symbol usage evidence.

Open each `get_symbol_references` usage `file` relative to the selected
`project.rootPath`, using its one-based `line`. Reference locations are derived
from files in that project, including when an older index stored paths relative
to a different launch directory. Missing source files are not returned as
openable references. When a reference parser is unavailable or cannot scan the
file, text matches use the current source rather than cached chunks; those
matches may include comments and strings.
The symbol prefilter also reads current source, so newly added symbols in an
already indexed file are not excluded by its older chunks. Newly created files
still need indexing before they can be searched for references.
Rebuild an older index with `reindex` if map or health output still contains
paths from a previous launch directory; those views read persisted metadata.

Search checks indexed source paths against the selected project and validates
retrieved candidates against the stored file-hash manifest before ranking or
limiting results. A relocated index, missing manifest, or changed/unreadable
candidate requires a full rebuild; MCP starts that rebuild and returns an
`indexing` response asking the caller to retry. It does not serve a stale path or
silently drop the top match. These checks cover retrieved source candidates,
not newly added files that have not yet been indexed.

### Core Tools

| Tool                    | Input                                                                                                   | Output                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_codebase`       | `query`, optional `intent`, `limit`, `filters`, `includeSnippets`, shared `project`/`project_directory` | Compact mode returns a bounded result set with `file`, `summary`, `score`, lightweight structural metadata (`symbol`, `symbolKind`, `scope`, `signaturePreview`), and `searchQuality` (`status`, `confidence`, optional `hint`, `tokenEstimate`, `warning`, `rerankerStatus`). Full mode adds richer relationships plus chunk-level `imports`, `exports`, and `complexity`. When `intent="edit"`, a decision card is returned with `ready`, `patterns`, `bestExample`, `impact`, and `whatWouldHelp`. |
| `get_team_patterns`     | optional `category`, shared `project`/`project_directory`                                               | Pattern frequencies, trends, golden files, conflicts                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `get_symbol_references` | `symbol`, optional `limit`, shared `project`/`project_directory`                                        | Concrete symbol usage evidence: `usageCount` + top usage snippets + `confidence` + `isComplete`. `confidence: "syntactic"` means static/source-based only (no runtime or dynamic dispatch). When Tree-sitter + file content are available, comments and string literals are excluded from the scan — the count reflects real identifier nodes only. Replaces the removed `get_component_usage`.                                                                                                       |
| `get_feature_context`   | `path`, optional exact `symbol`, shared `project`/`project_directory`                                   | Directly declared source-linked requirements, applicable code targets, declared tests, recorded runner evidence, current-file freshness checks, and diagnostics. MCP only; no CLI equivalent.                                                                                                                                                                                                                                                                                                         |
| `remember`              | `type`, `category`, `memory`, `reason`, shared `project`/`project_directory`                            | Persists to `.codebase-context/memory.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `get_memory`            | optional `category`, `type`, `query`, `limit`, shared `project`/`project_directory`                     | Memories with confidence decay scoring                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### Utility Tools

| Tool                           | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `get_codebase_metadata`        | Framework, dependencies, project stats               |
| `get_style_guide`              | Style rules from project documentation               |
| `detect_circular_dependencies` | Import cycles in the file graph                      |
| `refresh_index`                | Full or incremental re-index + git memory extraction |
| `get_indexing_status`          | Index state, progress, last stats                    |

### Source-linked feature context

`get_feature_context` returns context for one repository-relative POSIX `path` and optional exact
`symbol`. It is available through MCP, not the CLI. For example, call the tool with
`{"path":"examples/context-demo/src/app/checkout/checkout.component.ts","symbol":"CheckoutComponent"}`
and select the repository with the shared `project` argument when routing is ambiguous. The JSON
reply includes `status: "success"`, the resolved `rootPath`, `matches`, exact counts, and
`diagnostics`. Each matching attachment includes its requirement ID, source path and locator,
explicit targets, declared tests, and any recorded evidence. Target resolution is reported as
`resolved`, `missing`, `ambiguous`, or `unsupported`; source, target, and test records also report
whether their indexed bytes still match. Large replies omit whole matches or diagnostics and include
exact omission counts and summary diagnostics.
The same compact JSON is the human-inspection surface; `source.locator`, target status, `fresh`,
and plain-language diagnostic messages are not duplicated in a second prose rendering.

Add strict JSON files with a basename ending in `.context.json`, such as
`checkout.context.json`. CBC discovers these files during indexing while honoring project exclude
patterns and `.gitignore`. They are attachment metadata, not source chunks or embeddings. CBC
rebuilds the attachment sidecar on every explicit index pass, including when incremental source
indexing finds no changed vector rows. A missing or older feature-context projection returns
`index_refresh_required`; malformed sidecar data returns `index_invalid`. The v1 manifest shape is:

```json
{
  "schemaVersion": 1,
  "attachments": [
    {
      "requirementId": "CART-01",
      "source": {
        "path": "examples/context-demo/context/requirements.yaml",
        "locator": "claims[CART-01]"
      },
      "appliesTo": [
        {
          "path": "examples/context-demo/src/app/checkout/checkout.component.ts",
          "symbol": "CheckoutComponent"
        },
        { "path": "examples/context-demo/src/app/checkout/checkout.component.html" }
      ],
      "declaredTests": [
        {
          "path": "examples/context-demo/e2e/checkout.spec.ts",
          "name": "CART-01 removes a line and recalculates the checkout total"
        }
      ],
      "evidenceReceipts": ["examples/context-demo/test-results/context-evidence-receipt.json"]
    }
  ]
}
```

The requirement source may be Markdown, YAML, or another text file, but CBC treats it as opaque:
it hashes the exact bytes and returns the path plus locator. It does not parse the locator, resolve the
requirement ID from the source file, or verify that the claim is semantically correct. `appliesTo`
is the authority for scope. Links are direct only: imports, template references, service injection,
and other discovered relationships do not propagate a requirement to another file or symbol. A
file-level target applies to that file; optional `symbol` narrows it to an indexed exact symbol.
Names with multiple source ranges are reported as ambiguous instead of guessed. Unsupported symbol
forms remain explicitly unsupported.

`declaredTests` records intended coverage, not an execution result. A receipt is separate JSON
produced by a runner capture and records the test identity, outcome, Git commit, clean-tree claim,
requirement-source digest, environment, and report path plus digest. CBC checks receipt, source,
target, test, and report bytes again when queried. Evidence is current only for a passed receipt tied
to the same clean Git commit. Missing Git identity, dirty files, another commit, changed or missing
files, malformed receipts, and failed or skipped results cannot be presented as fresh evidence. A
receipt records runner output; it does not prove that the test assertion is adequate or the requirement
is satisfied. Generated reports and receipts should stay in ignored output directories.

Refresh the project index after adding or editing manifests, requirements, targets, tests, or
receipts:

```bash
node dist/index.js reindex
```

For the controlled Angular sample, install its locked dependencies once and run the capture
producer from the repository root:

```bash
pnpm run build
npm --prefix examples/context-demo ci
node examples/context-demo/scripts/capture-context-evidence.mjs
node dist/index.js reindex
```

Run the capture producer from a clean committed checkout. It uses Playwright's JSON report for the
named E2E test, refuses capture from a dirty worktree or changing `HEAD`, and writes report and
receipt files under the demo's ignored test-results directory. Then refresh with the repository's
locally built CLI and query the component path with `get_feature_context`. A successful capture
records the runner result and hashes; it does not establish that every Angular form resolves or that
the claim is satisfied.

## Project Routing

Behavior matrix:

| Situation                                            | Server behavior                                        |
| ---------------------------------------------------- | ------------------------------------------------------ |
| One known project                                    | Automatic routing                                      |
| Multiple known projects + active project already set | Automatic routing to the active project                |
| Multiple known projects + no active project          | `selection_required`                                   |
| No workspace context and no bootstrap path           | `selection_required` until the caller passes `project` |

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
12. **Payload budgeting** — final serialized search responses include `searchQuality.tokenEstimate`; warnings only appear above the 4K-token threshold and differ between compact and full mode.
13. **Full-mode chunk metadata** — when available, full-mode results surface chunk-level `imports` (top 5), `exports` (top 5), and cyclomatic `complexity`.

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

Current public proof bundle: [`docs/benchmark.md`](../docs/benchmark.md) and [`docs/comparison-table.md`](../docs/comparison-table.md).

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
- **Current checked-in gate truth:** `results/gate-evaluation.json` remains `pending_evidence` with `claimAllowed: false`; the raw-Claude baseline still lacks `averageFirstRelevantHit`, `codebase-memory-mcp` still fails the frozen usefulness comparisons, and the remaining named lanes are still `setup_failed`
- **Limits:** discovery mode is discovery-only, uses current shipped surfaces only, and does not claim implementation quality; named competitor runs remain a documented hybrid/manual lane rather than a built-in automated benchmark

## Limitations

- **Symbol refs are not a call-graph.** `get_symbol_references` counts identifier-node occurrences in the AST (comments/strings excluded via Tree-sitter). It does not distinguish call sites from type annotations, variable assignments, or imports. Full call-site-specific analysis (`call_expression` nodes only) is a roadmap item.
- **Impact is 2-hop max.** `computeImpactCandidates` walks direct importers then their importers. Full BFS reachability is on the roadmap.
- **Angular, React, Next.js, and NestJS have dedicated analyzers.** All other languages go through the Generic analyzer (30+ languages, chunking + import graph, no framework-specific signal extraction).
- **Default embedding model is `bge-small-en-v1.5` (512-token context).** Granite (8192 context) is opt-in via `EMBEDDING_MODEL`. OpenAI is opt-in via `EMBEDDING_PROVIDER=openai` — sends code externally.
- **Patterns are file-level frequency counts.** Not semantic clustering. Rising/Declining trend is derived from git commit recency for files using each pattern, not from usage semantics.
