# Codebase Context

[![npm version](https://img.shields.io/npm/v/codebase-context)](https://www.npmjs.com/package/codebase-context) [![license](https://img.shields.io/npm/l/codebase-context)](./LICENSE) [![node](https://img.shields.io/node/v/codebase-context)](https://github.com/PatrickSys/codebase-context/blob/master/package.json)

Codebase Context gives coding agents a map of your repository through MCP, for developers who want their agent to find relevant code and follow the team's patterns. Search, examples and project memory run locally by default.

## Set up your coding tools

**These commands use 2.4.0.** If that version is not available on npm yet, use the published 2.2.0 [setup guide](https://github.com/PatrickSys/codebase-context/blob/10ba0a635ff73cd5c5b011ffd5b31e7ed4656c65/docs/client-setup.md).

Automatic multi-tool setup is awaiting publication. The unpinned prompt below uses npm's latest release and will support this flow once these changes are released; until then, use the published setup guide above.

Use Node.js 22 or newer. Copy this prompt to your coding agent:

> Set up Codebase Context for this repository and any other repositories I explicitly name. Read https://github.com/PatrickSys/codebase-context#readme and the installed init help. Detect my supported coding tools and configure all of them, using `npx --yes codebase-context init --yes` once per repository. Preserve existing settings and instructions; explain any conflicting entry you cannot safely preserve. Add only a short, relevant usage note where this repository keeps agent instructions. Pass each repository's actual directory with --root. Once available, call Codebase Context to find a real source symbol and open its returned file. Report what works; if a tool needs reopening or trust approval, give me that exact next step and do not claim it connected.

To set up directly, run `npx --yes codebase-context@2.4.0 init` in your project. It shows Claude Code, Codex, Cursor and OpenCode together, with detected tools selected. Press Space to change the selection and Enter to apply it. With `--yes`, or without a terminal, it configures every detected tool. Use repeatable `--client` options to choose explicitly and `--root` to select another repository.

Each tool starts its own local server when needed. Reopen the tools and approve the server or project trust if asked. The first search builds the repository's index; setup itself does not index or change agent instructions.

### New in 2.4.0

- NestJS support from community contributor Aaron Olin. See the [analyzer details](./docs/capabilities.md#analyzers).
- Better React/Next.js detection and a fix for reranker passage scoring.
- Transformers.js v4 for local models.

Known limits: [Intel Mac indexing crash (#68)](https://github.com/PatrickSys/codebase-context/issues/68), [custom OpenAI endpoints (#70)](https://github.com/PatrickSys/codebase-context/issues/70) and [Ollama (#71)](https://github.com/PatrickSys/codebase-context/issues/71) remain open.

The existing [benchmark](https://github.com/PatrickSys/codebase-context/blob/master/docs/benchmark.md) reports 25.7% expected-file recovery versus jCodeMunch's 27.1% in a fixed retrieval comparison; it does not establish a winner or coding quality.

The [client setup guide](./docs/client-setup.md) covers detection, reruns, manual recipes for Gemini, GitHub Copilot and Windsurf, and advanced HTTP configuration. Existing custom entries are preserved and reported as conflicts. Config placement alone does not prove a client connected.

## What your agent gets

### Relevant code

`search_codebase` ranks files and symbols for the task instead of returning an unstructured dump. The agent can ask for a compact result first, then read the code it needs.

### Team patterns and examples

`get_team_patterns` shows the approaches used in the repository and points to representative files. Version `2.4.0` includes dedicated analyzers for Angular, React, Next.js and NestJS, with a generic analyzer for other stacks.

### Project memory

`remember` stores a convention, decision, gotcha, or past failure for the project. `get_memory` retrieves relevant entries in later sessions, including when the agent or editor changes.

### Review context

The `codebase-context-review` CLI creates a bounded context packet from a committed Git diff. It gives a reviewer context; it does not review code or prove review quality. See the [review-context guide](./docs/review-context.md).

## How it works

1. **Index locally.** Codebase Context scans the project, builds a keyword index, and creates local semantic embeddings - numeric representations used to match code by meaning as well as exact words.
2. **Understand the repository.** The agent can request a compact codebase map with structure, patterns, and representative files.
3. **Find the code for the task.** Search returns ranked files and symbols; the agent reads the selected files before editing.

The same information is available from the terminal. Run these commands from your project root. The first run downloads a local model and indexes the repository; time depends on repository size, CPU and model. Once it is ready, inspect the map and search for the code you need:

```bash
# Build or refresh the local index
npx -y codebase-context@2.4.0 reindex

# Repository structure, patterns, and representative files
npx -y codebase-context@2.4.0 map

# Ranked code search
npx -y codebase-context@2.4.0 search --query "auth middleware"

# Current team patterns
npx -y codebase-context@2.4.0 patterns
```

One stdio server can route across several repositories. Supply `project` in tool calls to select the intended repository; a successful selection becomes the default for later calls in that process. Some clients also announce workspace roots: one root can auto-select, while an ambiguous selection asks for a project instead of guessing. MCP deprecated Roots in its July 2026 revision, so explicit project selection is the documented default rather than a dependency on client discovery.

## See it

These are real CLI results from the open-source `angular-spotify` repository.

**Patterns and representative files**

![Codebase Context showing repository patterns and representative files](https://raw.githubusercontent.com/PatrickSys/codebase-context/master/docs/assets/patterns.png)

The map shows the patterns found in the project, how common they are, and files that demonstrate them.

**Search before an edit**

![Codebase Context showing a ranked search and edit preflight](https://raw.githubusercontent.com/PatrickSys/codebase-context/master/docs/assets/search-query.png)

The search result shows ranked files, relevant project patterns, and what the agent should read before it changes code.

More examples are available in the [CLI gallery](./docs/cli.md) and [walkthrough](https://github.com/PatrickSys/codebase-context/blob/master/docs/demo.md).

## Privacy

Code and indexes stay on the machine with the default local embedding provider. Docker, a GPU, and an API key are not required.

Cloud embeddings are optional. If you select a cloud provider, code chunks are sent to that provider to create the search index. The provider, model, project root, and local HTTP port can be changed through environment variables or the project config; see the [capabilities reference](./docs/capabilities.md).

This is the privacy boundary of Codebase Context itself. Your AI client may send search results or file contents to the model provider configured in that client. Codebase Context does not control that connection. If you commit and push `.codebase-context/memory.json`, the recorded project memory also travels with the repository.

Generated indexes belong in `.gitignore`. Project memory can be kept in version control when the team wants to share it:

```gitignore
.codebase-context/*
!.codebase-context/memory.json
```

## Evidence

Codebase Context runs locally through the Model Context Protocol (MCP), with indexed code kept on your machine by default.

Its ranked code search combines **Match words**, **Search by meaning**, and **Rank results** to give the agent ranked files, a best example, project patterns, relationships, and relevant memory before they edit.

The [benchmark](https://github.com/PatrickSys/codebase-context/blob/master/docs/benchmark.md) reports a corrected 100-attempt retrieval family across five local code-context tools: 99 completed attempts and 1 failed attempt. Codebase Context recovered 25.7% of expected gold files with 11.5% file precision in that fixed adapter run; jCodeMunch recovered 27.1% with 11.0% file precision. Raw-native is a deterministic lexical adapter here, not a full normal coding-agent baseline. These are retrieval observations, not a winner or a coding-quality claim. The [sanitized evidence extract](https://github.com/PatrickSys/codebase-context/blob/master/results/benchmark-presentation-evidence.json) records the exact values and source hashes.

The same report retains a separate 300-attempt repeatability history, a 30-run two-task full-agent pilot, and a metered replay whose tool-use validity remains unresolved. A historical Codebase Context indexing observation with embeddings enabled took about 12 minutes 31 seconds, but it does not establish warm-use speed, query latency, install cost, or a cross-tool index-speed ranking. The report does not combine these families into a pooled score and does not establish patch correctness or end-to-end coding quality. Earlier public reports are preserved separately in the [benchmark archive](https://github.com/PatrickSys/codebase-context/blob/master/docs/benchmark-prior-public-report.md).

The method and failures are documented so the measurements can be inspected with their limits.

## Limits

- Local semantic indexing does more work than a plain text index, especially on a fresh checkout and CPU-only machine.
- Retrieval measurements describe expected-file coverage, file precision, and reported `peakPrivateGb`, not patch correctness or end-to-end coding quality.
- The paired token observation covers two frozen investigation tasks and records observed agent behavior; it is not a universal token or time guarantee.
- Setup checks differ by client. The detailed guide distinguishes a written config, a config recognized by the client, a local connection, and instructions checked only against official docs.
- Version `2.4.0` has dedicated Angular, React, Next.js and NestJS analyzers. Other projects use the generic analyzer and the language parsers available for that stack.
- The default searchable-chunk limit is 5,000 per project. In `~/.codebase-context/config.json`, set `projects[].parsing.maxChunks` for a project that needs a higher limit.
- The agent must identify its repository in tool calls when no default or unambiguous client root is available. Concurrent HTTP client isolation is not established by the stdio routing checks.

## Reference

- [Client setup](./docs/client-setup.md#client-setup) - commands, config, proof level, and client limits
- [Capabilities](./docs/capabilities.md) - tools, response fields, routing, and configuration
- [CLI](./docs/cli.md) - terminal commands and example output
- [Benchmark](https://github.com/PatrickSys/codebase-context/blob/master/docs/benchmark.md) - method, measurements, and failures
- [Demo](https://github.com/PatrickSys/codebase-context/blob/master/docs/demo.md) - a complete repository walkthrough
- [Motivation](https://github.com/PatrickSys/codebase-context/blob/master/MOTIVATION.md) - the design problem and research background
- [Contributing](https://github.com/PatrickSys/codebase-context/blob/master/CONTRIBUTING.md) - local development and evaluation commands
- [Changelog](https://github.com/PatrickSys/codebase-context/blob/master/CHANGELOG.md) - release history

Elastic-2.0. See [LICENSE](./LICENSE).
