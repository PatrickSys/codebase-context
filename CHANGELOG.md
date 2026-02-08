# Changelog

## [1.4.1](https://github.com/PatrickSys/codebase-context/compare/v1.4.0...v1.4.1) (2026-01-29)

### Bug Fixes

- **lint:** disable no-explicit-any rule for AST manipulation code ([41547da](https://github.com/PatrickSys/codebase-context/commit/41547da2aa5529dce3d539c296d5e9d79df379fe))

## [Unreleased]

### Changed

- **Search ranking**: Removed framework-specific anchor/query promotion heuristics from core ranking flow to keep retrieval behavior generic across codebases.
- **Search transparency**: `search_codebase` now returns `searchQuality` with confidence and diagnostic signals when retrieval looks ambiguous.
- **Docs**: Updated README performance section to reflect shipped incremental refresh mode (`incrementalOnly`).

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
