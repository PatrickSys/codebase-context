# codebase-context

## Local-first second brain for AI agents working on your codebase

[![npm version](https://img.shields.io/npm/v/codebase-context)](https://www.npmjs.com/package/codebase-context) [![license](https://img.shields.io/npm/l/codebase-context)](./LICENSE) [![node](https://img.shields.io/node/v/codebase-context)](./package.json)

You're tired of AI agents writing code that 'just works' but fits like a square peg in a round hole - not your conventions, not your architecture, not your repo. Even with well-curated instructions. You correct the agent, it doesn't remember. Next session, same mistakes.

This MCP gives agents _just enough_ context so they match _how_ your team codes, know _why_, and _remember_ every correction.

Here's what codebase-context does:

**Finds the right context** - Search that doesn't just return code. Each result comes back with analyzed and quantified coding patterns and conventions, related team memories, file relationships, and quality indicators. It knows whether you're looking for a specific file, a concept, or how things wire together - and filters out the noise (test files, configs, old utilities) before the agent sees them. The agent gets curated context, not raw hits.

**Knows your conventions** - Detected from your code and git history, not only from rules you wrote. Seeks team consensus and direction by adoption percentages and trends (rising/declining), golden files. Tells the difference between code that's _common_ and code that's _current_ - what patterns the team is moving toward and what's being left behind.

**Remembers across sessions** - Decisions, failures, workarounds that look wrong but exist for a reason - the battle scars that aren't in the comments. Recorded once, surfaced automatically so the agent doesn't "clean up" something you spent a week getting right. Conventional git commits (`refactor:`, `migrate:`, `fix:`) auto-extract into memory with zero effort. Stale memories decay and get flagged instead of blindly trusted.

**Checks before editing** - Before editing something, you get a decision card showing whether there's enough evidence to proceed. If a symbol has four callers and only two appear in your search results, the card shows that coverage gap. If coverage is low, `whatWouldHelp` lists the specific searches to run before you touch anything.

One tool call returns all of it. Local-first - your code never leaves your machine by default.

### What it looks like

Real CLI output against `angular-spotify`, the repo used for the launch screenshots.

**Lead signal: pattern drift and golden files**

![codebase-context patterns screenshot](https://raw.githubusercontent.com/PatrickSys/codebase-context/master/docs/assets/patterns.png)

This is the part most tools miss: what the team is doing now, what it is moving away from, and which files are the strongest examples to follow.

**Before editing: preflight and impact**

![codebase-context search preflight screenshot](https://raw.githubusercontent.com/PatrickSys/codebase-context/master/docs/assets/search-query.png)

When the agent searches with edit intent, it gets a compact decision card: confidence, whether it's safe to proceed, which patterns apply, the best example, and which files are likely to be affected.

More CLI examples in [`docs/cli.md`](./docs/cli.md).

## Quick Start

```bash
claude mcp add codebase-context -- npx -y codebase-context
```

The server runs in two modes. Use stdio unless you need multiple clients connected at once:

| Mode | How it runs | When to use |
| ---- | ----------- | ------------ |
| **stdio** (default) | Process spawned by the client | One AI client talking to one or more repos |
| **HTTP** | Long-lived server at `http://127.0.0.1:3100/mcp` | Multiple clients sharing one server |

Client support at a glance:

| Client | stdio | HTTP |
| ------ | ----- | ---- |
| Claude Code | Yes | No (stdio only) |
| Claude Desktop | Yes | No |
| Cursor | Yes | Yes — `.cursor/mcp.json` with `type: "http"` |
| Windsurf | Yes | Not yet |
| Codex | Yes | Yes — `--mcp-config` flag |
| VS Code (Copilot) | Yes | No |
| OpenCode | Yes | Not documented yet |

Copy-pasteable templates: [`templates/mcp/stdio/.mcp.json`](./templates/mcp/stdio/.mcp.json) and [`templates/mcp/http/.mcp.json`](./templates/mcp/http/.mcp.json).

Full per-client setup, HTTP server instructions, and local build testing: [`docs/client-setup.md`](./docs/client-setup.md).

## Common First Commands

Three commands to get what usually takes a new developer weeks to piece together:

```bash
# What tech stack, architecture, and file count?
npx -y codebase-context metadata

# What does the team actually code like right now?
npx -y codebase-context patterns

# What team decisions were made (and why)?
npx -y codebase-context memory list
```

This is also what your AI agent consumes automatically via MCP tools; the CLI is the human-readable version.

## What it does

### The Search Tool (`search_codebase`)

One call returns ranked results with `file`, `summary`, `score`, compact type (`componentType:layer`), pattern trend signals, relationship hints, related team memories, a search quality assessment, and a preflight decision card when `intent="edit"`. The decision card shows `ready` (boolean), `nextAction` when not ready, `patterns` (do/avoid), `bestExample`, impact coverage (`"3/5 callers in results"`), and `whatWouldHelp`.

Default output is lean — if the agent wants code, it calls `read_file`. Add `includeSnippets: true` for inline code with scope headers (e.g. `// AuthService.getToken()`).

See [`docs/capabilities.md`](./docs/capabilities.md) for the full field reference.

### Patterns & Conventions (`get_team_patterns`)

Detects what your team actually does by analyzing the codebase: adoption percentages for DI, state management, testing, and library patterns; trend direction (Rising / Stable / Declining) from git recency; golden files ranked by modern pattern density; conflicts when two approaches both exceed 20%.

### Team Memory (`remember` + `get_memory`)

Record a decision once. It surfaces automatically in search results and preflight cards from then on. Conventional commits (`refactor:`, `migrate:`, `fix:`, `revert:`) from the last 90 days auto-extract into memory during indexing — no setup required.

Memory types: `convention`, `decision`, `gotcha`, `failure`. Confidence decay: conventions never decay, decisions 180-day half-life, gotchas/failures 90-day. Stale memories get flagged instead of blindly trusted.

## Tools

| Tool | What it does |
| ---- | ------------ |
| `search_codebase` | Hybrid search + decision card when `intent="edit"` |
| `get_team_patterns` | Pattern frequencies, golden files, conflict detection |
| `get_symbol_references` | Concrete references to a symbol (count + snippets) |
| `remember` | Record a convention, decision, gotcha, or failure |
| `get_memory` | Query team memory with confidence decay scoring |
| `get_codebase_metadata` | Project structure, frameworks, dependencies |
| `get_style_guide` | Style guide rules for the current project |
| `detect_circular_dependencies` | Import cycles between files |
| `refresh_index` | Full or incremental re-index + git memory extraction |
| `get_indexing_status` | Progress and stats for the current index |

## Multi-project

One server, multiple repos. Three cases:

| Case | What happens |
| ---- | ------------ |
| One project | Routing is automatic |
| Multiple projects, active project already set | Routes to the active project |
| Multiple projects, ambiguous | Returns `selection_required` — retry with `project` |

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

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `EMBEDDING_PROVIDER` | `transformers` | `openai` (fast, cloud) or `transformers` (local, private) |
| `OPENAI_API_KEY` | — | Required only if using `openai` provider |
| `CODEBASE_ROOT` | — | Bootstrap root for CLI and single-project MCP clients |
| `CODEBASE_CONTEXT_DEBUG` | — | Set to `1` for verbose logging |
| `EMBEDDING_MODEL` | `Xenova/bge-small-en-v1.5` | Local embedding model override |
| `CODEBASE_CONTEXT_HTTP` | — | Set to `1` to start in HTTP mode (same as `--http` flag) |
| `CODEBASE_CONTEXT_PORT` | `3100` | HTTP server port override (same as `--port`; ignored in stdio mode) |
| `CODEBASE_CONTEXT_CONFIG_PATH` | `~/.codebase-context/config.json` | Override the server config file path |

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

- [Client Setup](./docs/client-setup.md) — per-client config, HTTP setup, local build testing
- [Capabilities Reference](./docs/capabilities.md) — tool API, retrieval pipeline, decision card schema
- [CLI Gallery](./docs/cli.md) — formatted command output examples
- [Motivation](./MOTIVATION.md) — research and design rationale
- [Contributing](./CONTRIBUTING.md) — dev setup and eval harness
- [Changelog](./CHANGELOG.md)

## License

MIT
