# Capabilities Reference

Technical reference for what `codebase-context` ships today. For the user-facing overview, see [README.md](../README.md).

## CLI Reference

All shipped capabilities are available locally via the CLI (human-readable by default, `--json` for automation).
For a “gallery” of commands and examples, see `docs/cli.md`.

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

10 MCP tools + 1 optional resource (`codebase://context`). **Migration:** `get_component_usage` was removed; use `get_symbol_references` for symbol usage evidence.

### Core Tools

| Tool                    | Input                                                             | Output                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_codebase`       | `query`, optional `intent`, `limit`, `filters`, `includeSnippets` | Ranked results (`file`, `summary`, `score`, `type`, `trend`, `patternWarning`, `relationships`, `hints`) + `searchQuality` + decision card (`ready`, `nextAction`, `patterns`, `bestExample`, `impact`, `whatWouldHelp`) when `intent="edit"`. Hints capped at 3 per category. |
| `get_team_patterns`     | optional `category`                                               | Pattern frequencies, trends, golden files, conflicts                                                                                                                                 |
| `get_symbol_references` | `symbol`, optional `limit`                                        | Concrete symbol usage evidence: `usageCount` + top usage snippets + `confidence` + `isComplete`. `confidence: "syntactic"` means static/source-based only (no runtime or dynamic dispatch). Replaces the removed `get_component_usage`. |
| `remember`              | `type`, `category`, `memory`, `reason`                            | Persists to `.codebase-context/memory.json`                                                                                                                                          |
| `get_memory`            | optional `category`, `type`, `query`, `limit`                     | Memories with confidence decay scoring                                                                                                                                               |

### Utility Tools

| Tool                           | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `get_codebase_metadata`        | Framework, dependencies, project stats               |
| `get_style_guide`              | Style rules from project documentation               |
| `detect_circular_dependencies` | Import cycles in the file graph                      |
| `refresh_index`                | Full or incremental re-index + git memory extraction |
| `get_indexing_status`          | Index state, progress, last stats                    |

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
- **Embedding model**: `Xenova/bge-small-en-v1.5` (512 token context, fast, local-first) via `@xenova/transformers`. Override: `EMBEDDING_MODEL=ibm-granite/granite-embedding-30m-english` for Granite (8192 ctx, slower).
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
- Version gating: `index-meta.json` tracks format version; mismatches trigger automatic rebuild
- Crash-safe rebuilds: full rebuilds write to `.staging/` and swap atomically only on success
- Auto-heal: corrupted index triggers automatic full re-index on next search
- Relationships sidecar: `relationships.json` contains file import graph and symbol export index
- Storage: `.codebase-context/` directory (memory.json + generated files)

## Analyzers

- **Angular**: signals, standalone components, control flow syntax, lifecycle hooks, DI patterns, component metadata
- **Generic**: 30+ have indexing/retrieval coverage including PHP, Ruby, Swift, Scala, Shell, config/markup., 10 languages have full symbol extraction (Tree-sitter: TypeScript, JavaScript, Python, Java, Kotlin, C, C++, C#, Go, Rust). 

Notes:

- Language detection covers common extensions including `.pyi`, `.kt`/`.kts`, `.cc`/`.cxx`, and config formats like `.toml`/`.xml`.
- When Tree-sitter grammars are present, the Generic analyzer uses AST-aligned chunking and scope-aware prefixes for symbol-aware snippets (with fallbacks).

## Evaluation Harness

Reproducible evaluation is shipped as a CLI entrypoint backed by shared scoring/reporting code.

- **Command:** `npm run eval -- <codebaseA> <codebaseB>` (builds first, then runs `scripts/run-eval.mjs`)
- **Shared implementation:** `src/eval/harness.ts` + `src/eval/types.ts` (tests and CLI use the same scoring)
- **Frozen fixtures:**
  - `tests/fixtures/eval-angular-spotify.json` (real-world)
  - `tests/fixtures/eval-controlled.json` + `tests/fixtures/codebases/eval-controlled/` (offline controlled)
- **Reported metrics:** Top-1 accuracy, Top-3 recall, spec contamination rate, and a gate pass/fail
