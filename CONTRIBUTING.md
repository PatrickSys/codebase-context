# Contributing

## Setup

```bash
git clone https://github.com/PatrickSys/codebase-context.git
cd codebase-context
pnpm install
pnpm build

```

Note: this repo references a private submodule at `internal-docs/`. If you don't have access, clone without `--recurse-submodules` or ignore submodule update errors.

## Using the Package

See [README.md](./README.md) for configuration with Claude Desktop, VS Code, Cursor, etc.

## Project Structure

```
src/
  analyzers/
    angular/     # Angular-specific analysis
    nextjs/      # Next.js routes, metadata, and client/server detection
    react/       # React components, hooks, and context patterns
    generic/     # Fallback for non-Angular files
  core/
    indexer.ts   # Scans files, creates chunks
    search.ts    # Hybrid semantic + keyword search
  embeddings/    # Transformers.js wrapper
  storage/       # LanceDB wrapper
  index.ts       # MCP server entry point
  lib.ts         # Library exports for programmatic use
```

## What Would Help

**Vue analyzer** - Same deal. Detect components, composables, Pinia stores.

**Better search ranking** - The hybrid search in `src/core/search.ts` could use tuning. Currently uses RRF to combine semantic and keyword scores.

**Tests** - Run `pnpm test`. We use Vitest for unit and smoke testing.

## Adding a Framework Analyzer

1. Create `src/analyzers/<framework>/index.ts`
2. Implement `FrameworkAnalyzer` interface
3. Register in `src/index.ts`, `src/cli.ts`, and `src/lib.ts`

The interface is straightforward:

```typescript
interface FrameworkAnalyzer {
  name: string;
  canAnalyze(filePath: string, content?: string): boolean;
  analyze(filePath: string, content: string): Promise<AnalysisResult>;
  detectCodebaseMetadata(rootPath: string): Promise<CodebaseMetadata>;
}
```

## Running Locally

```bash
pnpm build
node dist/index.js /path/to/test/project
```

The server logs to stderr, so you can see what it's doing.

## Evaluation Harness

Run `pnpm eval` to measure search/ranking quality against frozen fixtures. Use this before releases or after changing search/ranking/chunking logic.

```bash
# Two codebases (defaults to bundled fixtures)
pnpm eval -- <codebaseA> <codebaseB>

# Offline smoke test (no network)
pnpm eval -- tests/fixtures/codebases/eval-controlled tests/fixtures/codebases/eval-controlled \
  --fixture-a=tests/fixtures/eval-controlled.json \
  --fixture-b=tests/fixtures/eval-controlled.json \
  --skip-reindex --no-rerank
```

Flags: `--help`, `--fixture-a`, `--fixture-b`, `--skip-reindex`, `--no-rerank`, `--no-redact`.

Save a report: `pnpm eval -- <path> --skip-reindex > eval-report.txt`

## Pull Requests

- Fork, branch, make changes
- Run `pnpm build` to make sure it compiles
- Test on an actual project
- Open PR with what you changed and why

No strict commit format, just be clear about what you're doing.

## Release Notes (PR titles)

This repo publishes to npm via an automated Release PR flow.

To keep releases predictable and human-readable, please use a Conventional-Commits style **PR title** (we usually squash-merge, and the PR title becomes the commit message):

- `feat: ...` (new feature)
- `fix: ...` (bug fix)
- `docs: ...` (docs-only)
- `chore: ...` (maintenance)
- `refactor: ...` (refactor)

Examples:

- `feat: add memory store for team conventions`
- `fix: avoid creating directories on invalid ROOT_PATH`
- `docs: clarify MCP client config and npx --yes`

Maintainers: release steps are documented in `RELEASING.md`.
