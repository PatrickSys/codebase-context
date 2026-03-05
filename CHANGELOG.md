# Changelog

## [1.8.0](https://github.com/PatrickSys/codebase-context/compare/v1.7.0...v1.8.0) (2026-03-05)


### Features

* CLI formatters + response types + debug gating ([#48](https://github.com/PatrickSys/codebase-context/issues/48)) ([7a6cd7b](https://github.com/PatrickSys/codebase-context/commit/7a6cd7b61e27adb62861d6a264c2ac1feba4d96d))
* **cli:** status formatter + CLI gallery docs ([#56](https://github.com/PatrickSys/codebase-context/issues/56)) ([b7bc5cc](https://github.com/PatrickSys/codebase-context/commit/b7bc5cc078635a5f0a4f33e47d431d21cdb83ccc))
* **impact:** persist import edge details + 2-hop impact candidates ([f296e30](https://github.com/PatrickSys/codebase-context/commit/f296e30834777770c70f9c20998576e123ea7592))
* **impact:** persist import edge details and 2-hop candidates ([5bd84a1](https://github.com/PatrickSys/codebase-context/commit/5bd84a1c6174c2ae6a413579c471e68ccc30f377))
* **indexing:** OpenAI embeddings + broader language coverage ([#57](https://github.com/PatrickSys/codebase-context/issues/57)) ([3c1c53b](https://github.com/PatrickSys/codebase-context/commit/3c1c53b15381640e96b2e62794436ca21a545ce4))
* **refs:** tree-sitter identifier-aware symbol references ([2aa0831](https://github.com/PatrickSys/codebase-context/commit/2aa08315103fa1b87b20d4f212ab271caeee670c))
* **refs:** Tree-sitter identifier-aware symbol references ([c23ffec](https://github.com/PatrickSys/codebase-context/commit/c23ffecf4174a6d683d4b985a754ca2ad840cfe1))
* **watcher:** chokidar auto-refresh with debounced incremental reindex ([59e3686](https://github.com/PatrickSys/codebase-context/commit/59e36867cd4048c858b08d2c551ca94adb6738ac))
* **watcher:** chokidar auto-refresh with debounced incremental reindex ([f300961](https://github.com/PatrickSys/codebase-context/commit/f300961b73b1ee867bfc43f0b2925d3f7c055447))


### Bug Fixes

* **cli:** formatter audit — render missing metadata fields, README callers qualifier ([d273729](https://github.com/PatrickSys/codebase-context/commit/d273729d16ffff3432b663b76db4964f5dce9822))
* **cli:** remove unused MetadataDependency import ([3f08f0e](https://github.com/PatrickSys/codebase-context/commit/3f08f0ed2ed27c10c2fae3ecf31c81771b22cb88))
* close v1.8 post-merge integration gaps ([#44](https://github.com/PatrickSys/codebase-context/issues/44)) ([d28460c](https://github.com/PatrickSys/codebase-context/commit/d28460c38bf91e8cb40a76501a03378c2edc11b5))
* **refs:** prevent out-of-root file reads from index ([1735e3c](https://github.com/PatrickSys/codebase-context/commit/1735e3cb51f808c3bd1c9afed4f1139bad851e8f))
* **watcher-tests:** await ready + harden Windows cleanup ([#55](https://github.com/PatrickSys/codebase-context/issues/55)) ([9929bb0](https://github.com/PatrickSys/codebase-context/commit/9929bb0cea7d9ad5a41f2719a8b1a48be1dc9909))
* **watcher:** allow debounce 0 and harden test ([070433c](https://github.com/PatrickSys/codebase-context/commit/070433cf79dace7420c26284ceeca7fea41dc8a1))
* **watcher:** queue refresh during indexing ([2d78110](https://github.com/PatrickSys/codebase-context/commit/2d781105f9d56e3b5644abe90ae88978e4d7b0d0))


### Performance Improvements

* **impact:** avoid per-candidate array alloc ([faf6e73](https://github.com/PatrickSys/codebase-context/commit/faf6e73101d1c76f17e755df35d8e34a1783a6fa))
* **impact:** avoid per-candidate array allocation ([04e68eb](https://github.com/PatrickSys/codebase-context/commit/04e68eb3c7d5a2a5aaa45a82ef6823e6f13ce6a9))

## [1.7.0](https://github.com/PatrickSys/codebase-context/compare/v1.6.1...v1.7.0) (2026-02-21)

### Features

- **02-03:** implement keyword-index symbol reference lookup ([ccfc564](https://github.com/PatrickSys/codebase-context/commit/ccfc5649a3f4e321bbd3770e5945f83213e103a6))
- **02-03:** register get_symbol_references MCP tool ([6f6bc3a](https://github.com/PatrickSys/codebase-context/commit/6f6bc3ae3bfa9af13c404028c1307d774b69291c))
- **03-01:** add frozen controlled eval fixture and local codebase ([46736ed](https://github.com/PatrickSys/codebase-context/commit/46736ed4c4681767164682a774e1ddf08ee81768))
- **03-03:** add multi-codebase eval runner command ([b065042](https://github.com/PatrickSys/codebase-context/commit/b065042f9a689d82485532872009af571d22db44))
- **03-03:** centralize eval harness scoring logic ([5c5319b](https://github.com/PatrickSys/codebase-context/commit/5c5319b4a3c9caf30f7b31de3ee210bc153ee58c))
- **04-01:** add curated grammar manifest, sync script, and publish inclusion ([908f39a](https://github.com/PatrickSys/codebase-context/commit/908f39a2c82a9630150262299ec8ae1f25c269ab))
- **04-01:** update tree-sitter loader to resolve packaged grammars and fail closed ([458520f](https://github.com/PatrickSys/codebase-context/commit/458520ff3d24bd9ff6399b6bedfe1b6776fc6579))
- **04-02:** add manifest-driven grammar CI test with fail-closed fallback ([2559405](https://github.com/PatrickSys/codebase-context/commit/2559405007e17bad6fffcf6ea61b97475f0da1e6))
- **05-01:** create AST-aligned chunking engine with symbol tree builder ([f865abc](https://github.com/PatrickSys/codebase-context/commit/f865abc0a3877441b492695c02ddca12fe9b36c6))
- **05-01:** wire AST-aligned chunker into GenericAnalyzer with 21 unit tests ([68a2d6d](https://github.com/PatrickSys/codebase-context/commit/68a2d6da844a9ffdb6104670c565f338487d2199))
- **05-02:** add scope-aware prefix generation to AST chunks ([3dbd43e](https://github.com/PatrickSys/codebase-context/commit/3dbd43eec1d6cdf63ec4d5094c870bf2ee6b164d))
- **06-01:** add index format metadata and headers ([a216c6d](https://github.com/PatrickSys/codebase-context/commit/a216c6dd2c7614b705525bc30ba8fddf918c7cf3))
- **06-01:** gate index consumers on IndexMeta validation ([6a52c0d](https://github.com/PatrickSys/codebase-context/commit/6a52c0d33d408a7463e036eac8a650c461c86a43))
- **06-02:** implement staging directory build and atomic swap for full rebuild ([d719801](https://github.com/PatrickSys/codebase-context/commit/d71980128795bdf8e7c7ab16beb350729a85e306))
- **AST indexing:** Implement relationship index ([#38](https://github.com/PatrickSys/codebase-context/issues/38)) ([5b05092](https://github.com/PatrickSys/codebase-context/commit/5b05092b4d5a4a08b117fdc06a3292afdcc8764e))
- expose all 10 MCP tools via CLI + document them ([#42](https://github.com/PatrickSys/codebase-context/issues/42)) ([7581fba](https://github.com/PatrickSys/codebase-context/commit/7581fbac5b4fd5bc52abc56d946bf55962870566))
- references confidence, remove get_component_usage, ranked search hints ([#39](https://github.com/PatrickSys/codebase-context/issues/39)) ([33616aa](https://github.com/PatrickSys/codebase-context/commit/33616aa48b165d5cfd95c44bc416cb74c4fd5cbf))
- rework decision-card to make it based on AST parsing ([#41](https://github.com/PatrickSys/codebase-context/issues/41)) ([ac4389d](https://github.com/PatrickSys/codebase-context/commit/ac4389d6cc55b7f8efc310a6e020bcd184a70adc))
- symbol ranking, smart snippets, and edit decision card ([#40](https://github.com/PatrickSys/codebase-context/issues/40)) ([03964b3](https://github.com/PatrickSys/codebase-context/commit/03964b3f40cc0fa0caf9768747a39fb559daaa8e))
- use tree-sitter symbols in generic analyzer ([b470709](https://github.com/PatrickSys/codebase-context/commit/b470709aa77f02325ed5a4e2b0710017020565da))

### Bug Fixes

- **02-01:** fall back when tree-sitter parse has errors ([8a7cd92](https://github.com/PatrickSys/codebase-context/commit/8a7cd92cab25b045b5108b1cba04773f644eab10))
- **02-tree-sitter-02:** prevent symbol-aware chunk merging ([fd02625](https://github.com/PatrickSys/codebase-context/commit/fd0262516e262eff0c17646eaca021d6288c6647))
- **03-02:** add regression guardrails for extraction and large-file safety ([a1c71de](https://github.com/PatrickSys/codebase-context/commit/a1c71de070b434f326dc80e627964c1540eea93f))
- **03-02:** harden tree-sitter extraction against byte-offset and parser failures ([375a48f](https://github.com/PatrickSys/codebase-context/commit/375a48f231c85d72157aa74ea964db27bf9a983e))

## [Unreleased]

### Added

- **Definition-first ranking**: Exact-name searches now show the file that _defines_ a symbol before files that use it. For example, searching `parseConfig` shows the function definition first, then callers.

### Refactored

- **Eliminated all `any` types**: 68 occurrences across 15 files now use proper TypeScript types. Replaced unsafe `Record<string, any>` with `Record<string, unknown>` and narrowed types using proper type guards. Promoted `@typescript-eslint/no-explicit-any` from `warn` to `error` to enforce strict typing.
- **Consolidated duplicate type definitions**: Single source of truth for shared types:
  - `PatternTrend` canonical location in `types/index.ts` (imported by `usage-tracker.ts`)
  - New `PatternCandidateBase` for shared pattern fields; `PatternCandidate extends PatternCandidateBase`; runtime adds optional internal fields
  - New `UsageLocation` base for both `ImportUsage` and `SymbolUsage` (extends with `preview` field)
  - `GoldenFile extends IntelligenceGoldenFile` to eliminate field duplication (`file`, `score`)
  - Introduced `RuntimePatternPrimary` and `DecisionCard` types for tool-specific outputs
- **Scope headers in code snippets**: When requesting snippets (`includeSnippets: true`), each code block now starts with a comment like `// UserService.login()` so agents know where the code lives without extra file reads.
- **Edit decision card**: When searching with `intent="edit"`, `intent="refactor"`, or `intent="migrate"`, results now include a decision card telling you whether there's enough evidence to proceed safely. The card shows: whether you're ready (`ready: true/false`), what to do next if not (`nextAction`), relevant team patterns to follow, a top example file, how many callers appear in results (`impact.coverage`), and what searches would help close gaps (`whatWouldHelp`).
- **Caller coverage tracking**: The decision card shows how many of a symbol's callers are in your search results. Low coverage (less than 40% when there are lots of callers) triggers an alert so you know to search more before editing.
- **Index versioning**: Index artifacts are versioned via `index-meta.json`. Mixed-version indexes are never served; version mismatches or corruption trigger automatic rebuild.
- **Crash-safe rebuilds**: Full rebuilds write to `.staging/` and swap atomically only on success. Failed rebuilds don't corrupt the active index.
- **Relationship sidecar**: New `relationships.json` artifact containing file import graph, reverse imports, and symbol export index. Updated incrementally alongside the main index.
- **References confidence + hints**: `get_symbol_references` now includes `confidence: "syntactic"` and `isComplete: boolean` to help agents assess result completeness. `search_codebase` results now include a structured `hints` object (capped callers/consumers/tests ranked by frequency) drawn from the relationships sidecar. **`get_component_usage` removed from MCP surface (11→10 tools).** If you previously used `get_component_usage`, use `get_symbol_references` for symbol usage evidence (usageCount, top snippets, callers/consumers).
- Tree-sitter-backed symbol extraction is now used by the Generic analyzer when available (with safe fallbacks).
- Expanded language/extension detection to improve indexing coverage (e.g. `.pyi`, `.php`, `.kt`/`.kts`, `.cc`/`.cxx`, `.cs`, `.swift`, `.scala`, `.toml`, `.xml`).
- New tool: `get_symbol_references` for concrete symbol usage evidence (usageCount + top snippets).
- Multi-codebase eval runner: `npm run eval -- <codebaseA> <codebaseB>` with per-codebase reports and combined summary.
- Shared eval scoring/reporting module (`src/eval/*`) used by both the CLI runner and the test suite.
- Second frozen eval fixture plus an in-repo controlled TypeScript codebase for fully-offline eval runs.
- Regression tests covering Tree-sitter Unicode slicing, parser cleanup/reset behavior, and large/generated file skipping.
- **Tree-sitter symbol references** (PR #49): identifier scan excludes comment/string nodes; `confidence: "syntactic"` returned; `usageCount` reflects real AST occurrences, not regex matches.
- **Import edge details** (PR #50): `importDetails` per edge (line number + imported symbols) persisted in `relationships.json`. Backward-compatible with existing `imports` field.
- **2-hop transitive impact** (PR #50): `search --intent edit` impact now shows direct importers (hop 1) and their importers (hop 2), each labeled with distance. Capped at 20.
- **Chokidar file watcher** (PR #52): index auto-refreshes in MCP server mode on file save (2 s debounce). No manual `reindex` needed during active editing sessions.
- **CLI human formatters** (PR #48): all 9 commands now render as structured human-readable output. `--json` flag on every command for agent/pipe consumption.
- **`status` + `reindex` formatters** (PR #56): status box with index health, progress, and last-built time. ASCII fallback via `CODEBASE_CONTEXT_ASCII=1`.
- **`docs/cli.md` gallery** (PR #56): command reference with output previews for all 9 CLI commands.

### Changed

- **Preflight response shape**: Renamed `reason` to `nextAction` for clarity. Removed internal fields (`evidenceLock`, `riskLevel`, `confidence`) so the output is stable and doesn't change shape unexpectedly.

### Fixed

- Null-pointer crash in GenericAnalyzer when chunk content is undefined.
- Tree-sitter symbol extraction now treats node offsets as UTF-8 byte ranges and evicts cached parsers on failures/timeouts.
- **Post-merge integration gaps** (v1.8 audit): Removed orphaned `get_component_usage` source file, deleted phantom allowlist entry, removed dead guidance strings referencing the deleted tool. Added fallback decision card when `intelligence.json` is absent during edit-intent searches, now returns `ready: false` with actionable guidance instead of silently skipping.
- Watcher initialization race: `onReady` hook ensures tests wait for chokidar readiness before asserting (PR #55).
- Windows temp dir cleanup hardened with retry/backoff to fix `ENOTEMPTY`/`EPERM` test flakes (PR #55).
- `--json` output now always pure JSON on stdout; status lines go to stderr (PR #48).

## [1.6.2] - 2026-02-17

Stripped it down for token efficiency, moved CLI code out of the protocol layer, and cleared structural debt.

### Changed

- **Search output**: `trend: "Stable"` is no longer emitted (only Rising/Declining carry signal). Added a compact `type` field (`service:data`) merging componentType and layer into 2 tokens. Removed `lastModified` considered noise.
- **searchQuality**: now includes `hint` (for next-step suggestion) when status is `low_confidence`, so agents get actionable guidance without a second tool call.
- **Tool description**: shortened to 2 actionable sentences, removed reference to `editPreflight` (which didn't exist in output). `intent` parameter is now discoverable on first scan.
- **CLI extraction**: `handleMemoryCli` moved from `src/index.ts` to `src/cli.ts`. Protocol file is routing only.
- **Angular self-registration**: `registerComplementaryPatterns('reactivity', ...)` moved from `src/index.ts` into `AngularAnalyzer` constructor. Framework patterns belong in their analyzer.

### Added

- `AGENTS.md` Lessons Learned section - captures behavioral findings from the 0216 eval: AI fluff loop, self-eval bias, static data as noise, agents don't read past first line.
- Release Checklist in `AGENTS.md`: CHANGELOG + README + capabilities.md + tests before any version bump.

## [1.6.1](https://github.com/PatrickSys/codebase-context/compare/v1.6.0...v1.6.1) (2026-02-15)

Fixed the quality assessment on the search tool bug, stripped search output from 15 fields to 6 reducing token usage by 50%, added CLI memory access, removed Angular patterns from core.

### Bug Fixes

- **Confident Idiot fix**: evidence lock now checks search quality - if retrieval is `low_confidence`, `readyToEdit` is forced `false` regardless of evidence counts.
- **Search output overhaul**: stripped from ~15 fields per result down to 6 (`file`, `summary`, `score`, `trend`, `patternWarning`, `relationships`). Snippets opt-in only.
- **Preflight flattened**: from nested `evidenceLock`/`epistemicStress` to `{ ready, reason }`.
- **Angular framework leakage**: removed hardcoded Angular patterns from `src/core/indexer.ts` and `src/patterns/semantics.ts`. Core is framework-agnostic again.
- **Angular analyzer**: fixed `providedIn: unknown` bug — metadata extraction path was wrong.
- **CLI memory access**: `codebase-context memory list|add|remove` works without any AI agent.
- guard null chunk.content crash ([6b89778](https://github.com/PatrickSys/codebase-context/commit/6b8977897665ea3207e1bbb0f5d685c61d41bbb8))

## [1.6.0](https://github.com/PatrickSys/codebase-context/compare/v1.5.1...v1.6.0) (2026-02-11)

### Features

- v1.6.0 search quality improvements ([#26](https://github.com/PatrickSys/codebase-context/issues/26)) ([8207787](https://github.com/PatrickSys/codebase-context/commit/8207787db45c9ee3940e22cb3fd8bc88a2c6a63b))

## [1.6.0](https://github.com/PatrickSys/codebase-context/compare/v1.5.1...v1.6.0) (2026-02-10)

### Added

- **Search Quality Improvements** — Weighted hybrid search with intent-aware classification
  - Intent-aware query classification (EXACT_NAME, CONCEPTUAL, FLOW, CONFIG, WIRING)
  - Reciprocal Rank Fusion (RRF, k=60) for robust rank-based score combination
  - Hard test-file filtering (eliminates spec contamination in non-test queries)
  - Import-graph proximity reranking (structural centrality boosting)
  - File-level deduplication (one best chunk per file)
- **Evaluation Harness** — Frozen fixture set with reproducible methodology
- **Embedding Upgrade** — Granite model support (47M params, 8192 context)
- **Chunk Optimization** — 100→50 lines, overlap 10→0, merge small chunks

### Changed

- **Dependencies**: `@xenova/transformers` v2 → `@huggingface/transformers` v3
- **Indexing**: Tighter chunks (50 lines) with zero overlap
- **Search**: RRF fusion immune to score distribution differences

### Fixed

- Intent-blind search (conceptual queries now classified and routed correctly)
- Spec file contamination (test files hard-filtered from non-test query results)
- Embedding truncation (granite's 8192 context eliminates previous 512 token limit)

### Note

**Re-indexing recommended** for best results due to chunking changes.
Existing indices remain readable — search still works without re-indexing.
To re-index: `refresh_index(incrementalOnly: false)` or delete `.codebase-context/` folder.

## [1.5.1](https://github.com/PatrickSys/codebase-context/compare/v1.5.0...v1.5.1) (2026-02-08)

### Bug Fixes

- use cosine distance for vector search scoring ([b41edb7](https://github.com/PatrickSys/codebase-context/commit/b41edb7e4c1969b04d834ec52a9ae43760e796a9))

## [1.5.0](https://github.com/PatrickSys/codebase-context/compare/v1.4.1...v1.5.0) (2026-02-08)

### Added

- **Preflight evidence lock**: `search_codebase` edit/refactor/migrate intents now return risk-aware preflight guidance with evidence lock scoring, impact candidates, preferred/avoid patterns, and related memories. ([#21](https://github.com/PatrickSys/codebase-context/issues/21))
- **Trust-aware memory handling**: Git-aware memory pattern support and confidence decay so stale or malformed evidence is surfaced as lower-confidence context instead of trusted guidance. ([#21](https://github.com/PatrickSys/codebase-context/issues/21))

### Changed

- **Search ranking**: Removed framework-specific anchor/query promotion heuristics from core ranking flow to keep retrieval behavior generic across codebases. ([#22](https://github.com/PatrickSys/codebase-context/issues/22))
- **Search transparency**: `search_codebase` now returns `searchQuality` with confidence and diagnostic signals when retrieval looks ambiguous. ([#22](https://github.com/PatrickSys/codebase-context/issues/22))
- **Incremental indexing state**: Persist indexing counters to `indexing-stats.json` and restore them on no-op incremental runs to keep status reporting accurate on large codebases. ([#22](https://github.com/PatrickSys/codebase-context/issues/22))
- **Docs**: Updated README performance section to reflect shipped incremental refresh mode (`incrementalOnly`).

### Fixed

- **No-op incremental stats drift**: Fixed under-reported `indexedFiles` and `totalChunks` after no-change incremental refreshes by preferring persisted stats over capped index snapshots. ([#22](https://github.com/PatrickSys/codebase-context/issues/22))
- **Memory date validation**: Invalid memory timestamps now degrade to stale evidence rather than being surfaced as semi-trusted data. ([#21](https://github.com/PatrickSys/codebase-context/issues/21))

## [1.4.1](https://github.com/PatrickSys/codebase-context/compare/v1.4.0...v1.4.1) (2026-01-29)

### Bug Fixes

- **lint:** disable no-explicit-any rule for AST manipulation code ([41547da](https://github.com/PatrickSys/codebase-context/commit/41547da2aa5529dce3d539c296d5e9d79df379fe))

## [1.4.0] - 2026-01-28

### Added

- **Memory System**: New `remember` and `get_memory` tools capture team conventions, decisions, and gotchas
  - **Types**: `convention` | `decision` | `gotcha`
  - **Categories**: `tooling`, `architecture`, `testing`, `dependencies`, `conventions`
  - **Storage**: `.codebase-context/memory.json` with content-based hash IDs (commit this)
  - **Safety**: `get_memory` truncates unfiltered results to 20 most recent
- **Integration with `get_team_patterns`**: Appends relevant memories when category overlaps
- **Integration with `search_codebase`**: Surfaces `relatedMemories` via keyword match in search results

### Changed

- **File Structure**: All MCP files now organized in `.codebase-context/` folder for cleaner project root
  - Vector DB: `.codebase-index/` → `.codebase-context/index/`
  - Intelligence: `.codebase-intelligence.json` → `.codebase-context/intelligence.json`
  - Keyword index: `.codebase-index.json` → `.codebase-context/index.json`
  - **Migration**: Automatic on server startup (legacy JSON preserved; vector DB directory moved)

### Fixed

- **Startup safety**: Validates `ROOT_PATH` before running migration to avoid creating directories on typo paths

### Why This Feature

Patterns show "what" (97% use inject) but not "why" (standalone compatibility). AGENTS.md can't capture every hard-won lesson. Decision memory gives AI agents access to the team's battle-tested rationale.

**Design principle**: Tool must be self-evident without AGENTS.md rules. "Is this about HOW (record) vs WHAT (don't record)"

**Inspired by**: v1.1 Pattern Momentum (temporal dimension) + memory systems research (Copilot Memory, Gemini Memory)

## [1.3.3] - 2026-01-18

### Fixed

- **Security**: Resolve `pnpm audit` advisories by updating `hono` to 4.11.4 and removing the vulnerable `diff` transitive dependency (replaced `ts-node` with `tsx` for `pnpm dev`).

### Changed

- **Docs**: Clarify private `internal-docs/` submodule setup, add `npx --yes` tip, document `CODEBASE_ROOT`, and list `get_indexing_status` tool.
- **Submodule**: Disable automatic updates for `internal-docs` (`update = none`).

### Removed

- **Dev**: Remove local-only `test-context.cjs` helper script.

## [1.3.2] - 2026-01-16

### Changed

- **Embeddings**: Batch embedding now uses a single Transformers.js pipeline call per batch for higher throughput.
- **Dependencies**: Bump `@modelcontextprotocol/sdk` to 1.25.2.

## [1.3.1] - 2026-01-05

### Fixed

- **Auto-Heal Semantic Search**: Detects LanceDB schema corruption (missing `vector` column), triggers re-indexing, and retries search instead of silently falling back to keyword-only results.

## [1.3.0] - 2026-01-01

### Added

- **Workspace Detection**: Monorepo support for Nx, Turborepo, Lerna, and pnpm workspaces
  - New utility: `src/utils/workspace-detection.ts`
  - Functions: `scanWorkspacePackageJsons()`, `detectWorkspaceType()`, `aggregateWorkspaceDependencies()`
- **Testing Infrastructure**: Vitest smoke tests for core utilities
  - Tests for workspace detection, analyzer registry, and indexer metadata
  - CI/CD workflow via GitHub Actions
- **Dependency Detection**: Added `@nx/` and `@nrwl/` prefix matching for build tools

### Fixed

- **detectMetadata() bug**: All registered analyzers now contribute to codebase metadata (previously only the first analyzer was called)
  - Added `mergeMetadata()` helper with proper array deduplication and layer merging

### Changed

- Updated roadmap: v1.3 is now "Extensible Architecture Foundation"

### Acknowledgements

Thanks to [@aolin480](https://github.com/aolin480) for accelerating the workspace detection roadmap and identifying the detectMetadata() limitation in their fork.

## 1.2.2 (2025-12-31)

### Fixed

- **Critical Startup Crash**: Fixed immediate "Exit Code 1" silent crash on Windows by handling unhandled rejections during startup
- **MCPJam Compatibility**: Removed `logging` capability (which was unimplemented) to support strict MCP clients like MCPJam
- **Silent Failure**: Added global exception handlers to stderr to prevent silent failures in the future

## 1.2.1 (2025-12-31)

### Fixed

- **MCP Protocol Compatibility**: Fixed stderr output during MCP STDIO handshake for strict clients
  - All startup `console.error` calls now guarded with `CODEBASE_CONTEXT_DEBUG` env var
  - Zero stderr output during JSON-RPC handshake (required by Warp, OpenCode, MCPJam)
  - Debug logs available via `CODEBASE_CONTEXT_DEBUG=1` environment variable
  - Minimal implementation: 2 files changed, 46 insertions, 25 deletions
  - Reported by [@aolin480](https://github.com/aolin480) in [#2](https://github.com/PatrickSys/codebase-context/issues/2)

## 1.2.0 (2025-12-29)

### Features

- **Actionable Guidance**: `get_team_patterns` now returns a `guidance` field with pre-computed decisions:
  - `"USE: inject() – 97% adoption, stable"`
  - `"AVOID: constructor DI – 3%, declining (legacy)"`
- **Pattern-Aware Search**: `search_codebase` results now include:
  - `trend`: `Rising` | `Stable` | `Declining` for each result
  - `patternWarning`: Warning message for results using declining patterns
- **Search Boosting**: Results are re-ranked based on pattern modernity:
  - +15% score boost for Rising patterns
  - -10% score penalty for Declining patterns

### Purpose

This release addresses **Search Contamination** — the proven problem where AI agents copy legacy code from search results. By adding trend awareness and actionable guidance, AI agents can now prioritize modern patterns over legacy code.

## 1.1.0 (2025-12-15)

### Features

- **Pattern Momentum**: Detect migration direction via git history. Each pattern in `get_team_patterns` now includes:
  - `newestFileDate`: ISO timestamp of the most recent file using this pattern
  - `trend`: `Rising` (≤60 days), `Stable`, or `Declining` (≥180 days)
- This solves the "3% Problem" — AI can now distinguish between legacy patterns being phased out vs. new patterns being adopted

### Technical

- New `src/utils/git-dates.ts`: Extracts file commit dates via single `git log` command
- Updated `PatternDetector` to track temporal data per pattern
- Graceful fallback for non-git repositories

## 1.0.1 (2025-12-11)

### Fixed

- Added `typescript` as runtime dependency (required by `@typescript-eslint/typescript-estree`)

## 1.0.0 (2025-12-11)

Initial release.

### Features

- **Semantic search**: Hybrid search combining semantic similarity with keyword matching
- **Pattern detection**: Detects team patterns (DI, signals, standalone) with usage frequencies
- **Golden Files**: Surfaces files that demonstrate all team patterns together
- **Internal library discovery**: Tracks usage counts per library, detects wrappers
- **Testing framework detection**: Detects Jest, Jasmine, Vitest, Cypress, Playwright from actual code
- **Angular analyzer**: Components, services, guards, interceptors, pipes, directives
- **Generic analyzer**: Fallback for non-Angular files (32 file extensions supported)
- **Local embeddings**: Transformers.js + BGE model, no API keys required
- **LanceDB vector storage**: Fast, local vector database

### Architecture

- Framework-agnostic core with pluggable analyzers
- Angular as first specialized analyzer (React/Vue extensible)
- tsconfig paths extraction for internal vs external import detection
