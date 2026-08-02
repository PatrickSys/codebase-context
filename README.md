# codebase-context

## Your coding agent doesn't understand your codebase.

[![npm version](https://img.shields.io/npm/v/codebase-context)](https://www.npmjs.com/package/codebase-context) [![license](https://img.shields.io/npm/l/codebase-context)](./LICENSE) [![node](https://img.shields.io/node/v/codebase-context)](https://github.com/PatrickSys/codebase-context/blob/master/package.json)

`codebase-context` gives AI coding agents a local understanding of your codebase through semantic code search, team conventions, patterns, and memory, so they start from less blind exploration and more relevant local evidence.

Start with a bounded conventions map that shows the architecture, dominant patterns, and strongest local examples. Then search for the exact file, symbol, or workflow you need.

Here's what codebase-context does:

**Starts with a bounded conventions map** - The first call shows architecture layers, active patterns, strongest local examples, and next calls without dumping vendored repos, fixtures, generated output, or oversized entrypoint lists into the default surface.

**Finds the right local example** - Search does not just return code. Each result comes back with pattern signals, file relationships, and quality indicators so the agent can move from the map to the most relevant local example instead of wandering through raw hits.

**Knows what is current** - Conventions are detected from your code and git history, not only from rules you wrote. The map distinguishes what is common from what is rising or declining, and points at the files that best represent the current direction.

**Adds support signals when you need them** - Team memory and edit-readiness checks stay available, but as supporting context after the map and search have already narrowed the work.

Map first, search second, local-first throughout. Your code never leaves your machine by default.

Benchmark status:

The [benchmark evidence page](https://github.com/PatrickSys/codebase-context/blob/master/docs/benchmark.md)
keeps two tracks separate. The older checked-in discovery gate is still
`pending_evidence` with `claimAllowed: false`. The separate local ContextBench
case study compares raw-native, codebase-context, jCodeMunch full MCP, Repowise
self-hosted MCP, and context-mode on 20 frozen open-source tasks.

The current public-safe evidence is 500 checks total: 400 retrieval/resource
checks plus 100 checks with token counters for reading returned context. It does not
name a benchmark winner. The practical read is simple: jCodeMunch and
codebase-context are close on file retrieval, jCodeMunch indexed much faster in
this setup, codebase-context completed all 80 retrieval checks but was expensive
to index with local Transformers embeddings, and Repowise kept 13 checks with no
usable context.

The 100/100 metered checks captured input, cached input, output, and reasoning
output tokens. The separate ~3.33B Codex orchestration cost is benchmark-build
overhead, not a per-tool runtime score. Patch quality, developer productivity,
token savings in a patch workflow, the model-provider bill, repeat stability,
winner, leaderboard, research-paper benchmark, and resource-efficiency claims
remain blocked.

### What it looks like

Real CLI output against `angular-spotify`, the repo used for the launch screenshots.

**Lead signal: pattern drift and best examples**

![codebase-context patterns screenshot](https://raw.githubusercontent.com/PatrickSys/codebase-context/master/docs/assets/patterns.png)

This is the part most tools miss: what the team is doing now, what it is moving away from, and which files are the strongest examples to follow.

**Before editing: preflight and impact**

![codebase-context search preflight screenshot](https://raw.githubusercontent.com/PatrickSys/codebase-context/master/docs/assets/search-query.png)

When the agent searches with edit intent, it gets a compact decision card: confidence, whether it's safe to proceed, which patterns apply, the best example, and which files are likely to be affected.

More CLI examples in [`docs/cli.md`](./docs/cli.md). Full walkthrough: [demo.md on GitHub](https://github.com/PatrickSys/codebase-context/blob/master/docs/demo.md).

## Quick Start

```bash
claude mcp add codebase-context -- npx -y codebase-context
```

The server runs in two modes. Use stdio unless you need multiple clients connected at once:

| Mode                | How it runs                                      | When to use                                |
| ------------------- | ------------------------------------------------ | ------------------------------------------ |
| **stdio** (default) | Process spawned by the client                    | One AI client talking to one or more repos |
| **HTTP**            | Long-lived server at `http://127.0.0.1:3100/mcp` | Multiple clients sharing one server        |

Client support at a glance:

| Client            | stdio | HTTP                                         |
| ----------------- | ----- | -------------------------------------------- |
| Claude Code       | Yes   | Yes — `claude mcp add --transport http`      |
| Claude Desktop    | Yes   | No                                           |
| Cursor            | Yes   | Yes — `.cursor/mcp.json` with `type: "http"` |
| Windsurf          | Yes   | No documented HTTP setup                     |
| Codex             | Yes   | Yes — `codex mcp add --url`                  |
| Gemini CLI        | Yes   | Yes                                          |
| VS Code (Copilot) | Yes   | No                                           |
| OpenCode          | Yes   | No documented HTTP setup                     |
| GitHub Copilot CLI | Yes  | Yes                                          |

Copy-pasteable templates: [`templates/mcp/stdio/.mcp.json`](./templates/mcp/stdio/.mcp.json) and [`templates/mcp/http/.mcp.json`](./templates/mcp/http/.mcp.json).

Full per-client setup, HTTP server instructions, and local build testing: [`docs/client-setup.md`](./docs/client-setup.md).

## First Use

Get a conventions map of your codebase before exploring or editing:

```bash
# See your codebase conventions — architecture layers, patterns, best examples
npx -y codebase-context map

# Then search for what you need
npx -y codebase-context search --query "auth middleware"
```

Your AI agent uses the same map via the `codebase://context` MCP resource on first call.

## Common First Commands

Three commands to understand a repo before you edit it:

```bash
# What are the main conventions and best examples?
npx -y codebase-context map

# Then search for the local example you need
npx -y codebase-context search --query "auth middleware"

# What patterns is the team actually using right now?
npx -y codebase-context patterns
```

This is also what your AI agent consumes automatically via MCP tools; the CLI is the human-readable version of the same map-plus-search flow.

## What it does

### The Search Tool (`search_codebase`)

One call returns ranked results with `file`, `summary`, `score`, compact type (`componentType:layer`), pattern trend signals, relationship hints, related team memories, a search quality assessment, and a preflight decision card when `intent="edit"`. The decision card shows `ready` (boolean), `nextAction` when not ready, `patterns` (do/avoid), `bestExample`, impact coverage (`"3/5 callers in results"`), and `whatWouldHelp`.

Default output is lean — if the agent wants code, it calls `read_file`. Add `includeSnippets: true` for inline code with scope headers (e.g. `// AuthService.getToken()`).

See [`docs/capabilities.md`](./docs/capabilities.md) for the full field reference.

### Patterns & Conventions (`get_team_patterns`)

Detects what your team actually does by analyzing the codebase: adoption percentages for DI, state management, testing, and library patterns; trend direction (Rising / Stable / Declining) from git recency; strongest local examples ranked by modern pattern density; conflicts when two approaches both exceed 20%.

### Team Memory (`remember` + `get_memory`)

Record a decision once. It surfaces automatically in search results and preflight cards from then on. Conventional commits (`refactor:`, `migrate:`, `fix:`, `revert:`) from the last 90 days auto-extract into memory during indexing — no setup required.

Memory types: `convention`, `decision`, `gotcha`, `failure`. Confidence decay: conventions never decay, decisions 180-day half-life, gotchas/failures 90-day. Stale memories get flagged instead of blindly trusted.

## Tools

| Tool                           | What it does                                          |
| ------------------------------ | ----------------------------------------------------- |
| `search_codebase`              | Hybrid search + decision card when `intent="edit"`    |
| `get_team_patterns`            | Pattern frequencies, best examples, conflict detection |
| `get_symbol_references`        | Concrete references to a symbol (count + snippets)    |
| `remember`                     | Record a convention, decision, gotcha, or failure     |
| `get_memory`                   | Query team memory with confidence decay scoring       |
| `get_codebase_metadata`        | Project structure, frameworks, dependencies           |
| `get_style_guide`              | Style guide rules for the current project             |
| `detect_circular_dependencies` | Import cycles between files                           |
| `refresh_index`                | Full or incremental re-index + git memory extraction  |
| `get_indexing_status`          | Progress and stats for the current index              |

## Multi-project

One server, multiple repos. Three cases:

| Case                                          | What happens                                        |
| --------------------------------------------- | --------------------------------------------------- |
| One project                                   | Routing is automatic                                |
| Multiple projects, active project already set | Routes to the active project                        |
| Multiple projects, ambiguous                  | Returns `selection_required` — retry with `project` |

`project` accepts a project root path, file path, `file://` URI, or relative subproject path (e.g. `apps/dashboard`).

```json
{
  "name": "search_codebase",
  "arguments": {
    "query": "auth interceptor",
    "project": "apps/dashboard"
  }
}
```

If you get `selection_required`, retry with one of the paths from `availableProjects`. Full routing details and response shapes in [`docs/capabilities.md`](./docs/capabilities.md#project-routing).

## Language Support

10 languages with full symbol extraction via Tree-sitter: TypeScript, JavaScript, Python, Java, Kotlin, C, C++, C#, Go, Rust. 30+ languages with indexing and retrieval coverage, including PHP, Ruby, Swift, Scala, Shell, and config formats. Angular, React, and Next.js have dedicated analyzers; everything else uses the Generic analyzer with AST-aligned chunking when a grammar is available.

## Configuration

| Variable                       | Default                           | Description                                                         |
| ------------------------------ | --------------------------------- | ------------------------------------------------------------------- |
| `EMBEDDING_PROVIDER`           | `transformers`                    | `openai` (fast, cloud) or `transformers` (local, private)           |
| `OPENAI_API_KEY`               | —                                 | Required only if using `openai` provider                            |
| `CODEBASE_ROOT`                | —                                 | Bootstrap root for CLI and single-project MCP clients               |
| `CODEBASE_CONTEXT_DEBUG`       | —                                 | Set to `1` for verbose logging                                      |
| `EMBEDDING_MODEL`              | `Xenova/bge-small-en-v1.5`        | Local embedding model override                                      |
| `CODEBASE_CONTEXT_HTTP`        | —                                 | Set to `1` to start in HTTP mode (same as `--http` flag)            |
| `CODEBASE_CONTEXT_PORT`        | `3100`                            | HTTP server port override (same as `--port`; ignored in stdio mode) |
| `CODEBASE_CONTEXT_CONFIG_PATH` | `~/.codebase-context/config.json` | Override the server config file path                                |

## Performance

- **First indexing**: 2-5 minutes for ~30k files (embedding computation).
- **Subsequent queries**: milliseconds from cache.
- **Incremental updates**: `refresh_index` with `incrementalOnly: true` processes only changed files (SHA-256 manifest diffing).

## File Structure

```
.codebase-context/
  memory.json         # Team knowledge (should be persisted in git)
  index-meta.json     # Index metadata and version (generated)
  intelligence.json   # Pattern analysis (generated)
  relationships.json  # File/symbol relationships (generated)
  index.json          # Keyword index (generated)
  index/              # Vector database (generated)
```

**Recommended `.gitignore`:**

```gitignore
# Codebase Context - ignore generated files, keep memory
.codebase-context/*
!.codebase-context/memory.json
```

## What to add to your CLAUDE.md / AGENTS.md

Paste this into `.cursorrules`, `CLAUDE.md`, `AGENTS.md`, or wherever your AI reads project instructions:

```markdown
## Codebase Context (MCP)

**Start of every task:** Call `get_memory` to load team conventions before writing any code.

**Before editing existing code:** Call `search_codebase` with `intent: "edit"`. If the preflight card says `ready: false`, read the listed files before touching anything.

**Before writing new code:** Call `get_team_patterns` to check how the team handles DI, state, testing, and library wrappers — don't introduce a new pattern if one already exists.

**When asked to "remember" or "record" something:** Call `remember` immediately, before doing anything else.

**When adding imports that cross module boundaries:** Call `detect_circular_dependencies` with the relevant scope after adding the import.
```

These are the behaviors that make the most difference day-to-day. Copy, trim what doesn't apply to your stack, and add it once.

## Links

- [Benchmark](https://github.com/PatrickSys/codebase-context/blob/master/docs/benchmark.md) — benchmark evidence, case-study boundaries, and gate truth
- [Demo](https://github.com/PatrickSys/codebase-context/blob/master/docs/demo.md) — real CLI walkthrough
- [Client Setup](./docs/client-setup.md) — per-client config, HTTP setup, local build testing
- [Capabilities Reference](./docs/capabilities.md) — tool API, retrieval pipeline, decision card schema
- [CLI Gallery](./docs/cli.md) — formatted command output examples
- [Motivation](https://github.com/PatrickSys/codebase-context/blob/master/MOTIVATION.md) — research and design rationale
- [Contributing](https://github.com/PatrickSys/codebase-context/blob/master/CONTRIBUTING.md) — dev setup and eval harness
- [Changelog](https://github.com/PatrickSys/codebase-context/blob/master/CHANGELOG.md)

## License

Elastic-2.0
