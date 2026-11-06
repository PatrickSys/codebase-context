# Codebase Context

[![npm version](https://img.shields.io/npm/v/codebase-context)](https://www.npmjs.com/package/codebase-context) [![license](https://img.shields.io/npm/l/codebase-context)](./LICENSE) [![node](https://img.shields.io/node/v/codebase-context)](https://github.com/PatrickSys/codebase-context/blob/master/package.json)

Local repository maps, code search and symbol references for coding agents. Codebase Context exposes these through MCP and a CLI so an agent can inspect the repository before editing it.

## Published beta: 2.3.1-beta.0 (stable: 2.2.0)

As checked on **4 November 2026**, npm `beta` points to **`2.3.1-beta.0`**, while npm `latest` remains **`2.2.0`**. The beta requires **Node.js 22 or newer**. An unpinned `npx -y codebase-context` may use an already installed local version; without one, it resolves npm `latest` (currently the stable `2.2.0`). To select the published beta explicitly, use `npx -y codebase-context@2.3.1-beta.0 --version`. A source checkout or a local tarball is separate from a verified registry release.

**Fresh beta indexes use keyword search without downloading an embedding or reranker model.** Existing indexes keep their recorded mode. Semantic indexing is an explicit option; its optional runtimes and model downloads are separate from the default path.

### Try the beta or a local build from the terminal

Use an explicitly installed `2.3.1-beta.0`, a built checkout (`pnpm install`, then `pnpm build` in the CBC checkout) or an installed local tarball. From the repository you want to inspect, point Node at that installation's actual entrypoint:

```bash
node /path/to/codebase-context/dist/index.js --version
node /path/to/codebase-context/dist/index.js map
node /path/to/codebase-context/dist/index.js search --query "a symbol or feature in this repository" --limit 5
node /path/to/codebase-context/dist/index.js status
```

Replace the paths and query with your own. For a tarball installed under `/path/to/cbc-local`, the entrypoint is `/path/to/cbc-local/node_modules/codebase-context/dist/index.js`. Quote paths containing spaces.

`map` builds an index when the folder has no previous index. It then returns a bounded repository map. Search returns ranked source locations; open the returned code before relying on it. Low confidence means weak matching evidence, not that an implementation is absent.

To refresh the index, use `reindex`. Omitting mode flags preserves the recorded mode; `reindex --no-embeddings` explicitly selects keyword-only indexing. `reindex --embeddings` selects the configured embedding provider and requires optional LanceDB storage. The default local provider also requires Transformers and may download models; an explicitly configured remote provider has its own connection requirements. Changing modes requires a full rebuild, including when `--incremental` is supplied.

## Set up your AI client

From the target repository, the installed beta or built source can write project registrations for selected detected clients:

```bash
node /path/to/codebase-context/dist/index.js init
# Or select one client explicitly:
node /path/to/codebase-context/dist/index.js init --client codex --root /path/to/project --yes
```

The wizard recognizes Claude Code, Codex, Cursor and OpenCode. It saves the Node binary and package entrypoint that ran setup. If that installation or its npx cache is moved or removed, rerun setup. Writing a config does not prove that a native client connected or completed a coding task.

After registration, restart the client and ask:

> Use Codebase Context to find [feature] in this repository. Pass this repository's absolute path as project, wait for indexing if needed, and open the relevant source files.

The [client setup guide](./docs/client-setup.md) contains beta setup instructions and dated checks for the older stable package. Historical manual recipes, including Windsurf, retain their dated verification limits. For example, the following manual registration leaves the package version unpinned; it may use an already installed local version or fall back to npm `latest`, so it does **not** reliably select the beta:

```bash
claude mcp add --scope user --transport stdio codebase-context -- npx -y codebase-context
```

The default transport is stdio: the client starts the server. HTTP is an advanced option with client-specific setup. Explicit `project` selection is the portable default. A successful selection becomes active for later calls in that server process; select again after restarting or changing repositories.

## What your agent can inspect

- **Repository map:** structure, detected patterns and example files before narrowing to a task.
- **Code search:** bounded, ranked results with source locations and search-quality information. The default compact response contains at most six results.
- **Symbol references:** static identifier occurrences. They are not a runtime call graph.
- **File relationships:** TypeScript/JavaScript imports and re-exports, with unresolved or stale edges reported. Python and Go import navigation are not supported.
- **Team patterns:** file-level frequencies and example files. These are observations about the repository, not prescriptions about code quality.
- **Project memory:** `remember` and `get_memory` store and retrieve project conventions, decisions, gotchas and failures.
- **Review context:** `codebase-context-review` builds a bounded packet from a committed Git diff. It does not review code or establish reviewer quality. The [review-context guide](./docs/review-context.md) retains a separate historical version preview; it is not evidence of this candidate's publication.

Dedicated analyzers in the source cover Angular, React, Next.js and NestJS. Other files use the generic analyzer and available parsers. See the [capabilities reference](./docs/capabilities.md) for scope and limitations.

## Privacy and storage

The default keyword index is built locally. Docker, a GPU and an API key are not required. Optional local embeddings also run on the machine. If you explicitly configure a remote embedding provider, code chunks are sent to that provider.

Your AI client may send returned code to its own model provider; CBC does not control that connection. Project memory also travels with the repository if you commit and push it.

Generated index data should stay out of version control. To share project memory while ignoring the generated index:

```gitignore
.codebase-context/*
!.codebase-context/memory.json
```

## Evidence and limits

The [benchmark report](https://github.com/PatrickSys/codebase-context/blob/master/docs/benchmark.md) and [prior report archive](https://github.com/PatrickSys/codebase-context/blob/master/docs/benchmark-prior-public-report.md) describe separate historical experiments. These are retrieval observations, not a winner or a coding-quality claim. This historical evidence does not establish patch correctness or end-to-end coding quality. Versions, fixtures and failure records matter; these reports do not certify this candidate. This draft makes no claim that CBC beats text search, improves coding outcomes, or reduces time or tokens.

The default keyword path can miss natural-language questions when their vocabulary differs from the code. A returned file and a high score are not proof that an answer is correct. Inspect the cited implementation. Optional semantic search has not established a retrieval-quality advantage for this candidate.

Other practical limits:

- The default keyword index holds at most 5,000 searchable chunks per project. `projects[].parsing.maxChunks` can raise that limit.
- Search has bounded candidate inspection. Narrow a query when the candidate budget is exhausted; refresh when source files changed or became unavailable.
- Existing formats or incomplete generations can require an explicit rebuild or recovery choice. A failed operation is not a successful recovery.
- Setup evidence differs by client. Config writing, protocol connectivity and native-client task completion are separate checks.
- Stdio routing checks do not establish concurrent HTTP client isolation.

## Reference

- [Client setup](./docs/client-setup.md) — candidate registration, dated checks and limits
- [Capabilities](./docs/capabilities.md) — tools, routing, configuration and optional modes
- [CLI](./docs/cli.md) — local-candidate commands and historical illustrations
- [Benchmark](https://github.com/PatrickSys/codebase-context/blob/master/docs/benchmark.md) — historical methods, observations and failures
- [Contributing](https://github.com/PatrickSys/codebase-context/blob/master/CONTRIBUTING.md) — local development and evaluation commands
- [Changelog](https://github.com/PatrickSys/codebase-context/blob/master/CHANGELOG.md) — candidate changes and historical entries

Elastic-2.0. See [LICENSE](./LICENSE).
