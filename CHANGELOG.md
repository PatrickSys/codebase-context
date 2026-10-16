# Changelog

## [2.4.0](https://github.com/PatrickSys/codebase-context/compare/v2.3.0...v2.4.0) (2026-10-16)

- Added NestJS project analysis and improved React and Next.js pattern detection.
- Made the maximum number of indexed chunks configurable for each project.
- Added bounded review context packets generated from committed changes.
- Added project-folder setup for Claude Code and Codex.
- Added support for Node.js 22 and 24.
- Fixed local search reranking and improved command help with usage guidance.
- Search now explains how to check indexing status while an index is being built.

## [2.3.0](https://github.com/PatrickSys/codebase-context/compare/v2.2.0...v2.3.0) (2026-04-30)

- Expanded language coverage and added optional OpenAI embeddings.
- Fixed recovery from silent semantic-search failures and made full index rebuilds atomic.

## [2.2.0](https://github.com/PatrickSys/codebase-context/compare/v1.10.0...v2.2.0) (2026-04-17)

- Introduced a bounded conventions map for quick discovery, with the full map available on request.
- Local CLI commands no longer load the MCP server runtime before dispatch.

## [1.10.0](https://github.com/PatrickSys/codebase-context/compare/v1.9.0...v1.10.0) (2026-04-14)

- Added HTTP transport and server configuration for registering projects.
- Added React and Next.js analyzers and project-specific analyzer hints.
- Added an interactive setup wizard and a human-readable CLI with JSON output.
- Added compact and full search modes with freshness-aware guidance for edit requests.

## [1.9.0](https://github.com/PatrickSys/codebase-context/compare/v1.8.2...v1.9.0) (2026-03-19)

- Added workspace-aware routing for projects in multi-project repositories.
- Fixed recursive exclude handling and improved MCP process cleanup.

## [1.8.2](https://github.com/PatrickSys/codebase-context/compare/v1.8.1...v1.8.2) (2026-03-05)

- Fixed installation with npx from the published package.

## [1.8.1](https://github.com/PatrickSys/codebase-context/compare/v1.8.0...v1.8.1) (2026-03-05)

- Removed legacy testing framework categories from team-pattern results.

## [1.8.0](https://github.com/PatrickSys/codebase-context/compare/v1.7.0...v1.8.0) (2026-03-05)

- Added automatic index refresh while files change and two-hop impact context for imported code.
- Added readable CLI output, with JSON output available for scripts.
- Prevented indexed references from reading files outside the project root.

## [1.7.0](https://github.com/PatrickSys/codebase-context/compare/v1.6.1...v1.7.0) (2026-02-21)

- Added symbol-reference search with usage details and caller or consumer hints.
- Added syntax-aware indexing and scope-aware context for code snippets.
- Search can now include edit guidance based on parsed code structure.

## [1.6.2] - 2026-02-17

- Made search results more compact and added actionable hints when retrieval confidence is low.
- Added commands to list, add, and remove team memories without an AI client.

## [1.6.1](https://github.com/PatrickSys/codebase-context/compare/v1.6.0...v1.6.1) (2026-02-15)

- Low-confidence search results no longer signal that an edit is ready.
- Made detailed snippets optional and added standalone CLI access to team memories.
- Fixed Angular provider metadata extraction and a crash on missing chunk content.

## [1.6.0](https://github.com/PatrickSys/codebase-context/compare/v1.5.1...v1.6.0) (2026-02-11)

- Improved search ranking with follow-up search quality fixes.

## [1.6.0](https://github.com/PatrickSys/codebase-context/compare/v1.5.1...v1.6.0) (2026-02-10)

- Search ranking now considers query intent and combines keyword and semantic results.
- Updated local embeddings and chunking to handle longer code context.
- Existing indexes remain readable; re-index to apply the updated chunking.

## [1.5.1](https://github.com/PatrickSys/codebase-context/compare/v1.5.0...v1.5.1) (2026-02-08)

- Vector search now uses cosine distance.

## [1.5.0](https://github.com/PatrickSys/codebase-context/compare/v1.4.1...v1.5.0) (2026-02-08)

- Added risk-aware guidance and related code context for edit, refactor, and migration searches.
- Search results now report confidence when retrieval is ambiguous; memory evidence accounts for age and validity.
- Incremental refresh now preserves indexing status when no files have changed.

## [1.4.1](https://github.com/PatrickSys/codebase-context/compare/v1.4.0...v1.4.1) (2026-01-29)

No user-facing changes.

## [1.4.0] - 2026-01-28

- Added team memory for recording and retrieving conventions, decisions, and gotchas.
- Moved local indexes and project intelligence into a shared data directory, with migration from earlier locations.

## [1.3.3] - 2026-01-18

- Updated a dependency and removed a vulnerable transitive package.

## [1.3.2] - 2026-01-16

- Batch embedding now uses one model pipeline call per batch.

## [1.3.1] - 2026-01-05

- Fixed recovery from semantic-search index corruption so search can retry after rebuilding the index.

## [1.3.0] - 2026-01-01

- Added workspace detection for Nx, Turborepo, Lerna, and pnpm projects.
- Fixed project metadata detection so all applicable analyzers contribute their results.

## 1.2.2 (2025-12-31)

- Fixed a Windows startup crash and improved compatibility with strict MCP clients.
- Startup failures now produce diagnostic output instead of failing silently.

## 1.2.1 (2025-12-31)

- Improved MCP client compatibility by keeping startup output clear during the protocol handshake.

## 1.2.0 (2025-12-29)

- Added actionable team-pattern guidance and warnings when search results use declining patterns.

## 1.1.0 (2025-12-15)

- Added pattern trends based on file history, helping distinguish rising, stable, and declining patterns.

## 1.0.1 (2025-12-11)

- Fixed a missing runtime dependency needed for TypeScript parsing.

## 1.0.0 (2025-12-11)

- First release with local hybrid code search, team-pattern discovery, and Angular and generic analyzers.
- Added local embeddings and vector storage for semantic search.
