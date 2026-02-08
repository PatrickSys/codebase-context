# codebase-context

[![npm version](https://img.shields.io/npm/v/codebase-context)](https://www.npmjs.com/package/codebase-context) [![license](https://img.shields.io/npm/l/codebase-context)](./LICENSE) [![node](https://img.shields.io/node/v/codebase-context)](./package.json)

A second brain for AI coding agents. MCP server that remembers team decisions, tracks pattern evolution, and guides every edit with evidence.

## Quick Start

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context", "/path/to/your/project"]
    }
  }
}
```

### VS Code (Copilot)

Add `.vscode/mcp.json` to your project root:

```json
{
  "servers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context", "${workspaceFolder}"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context", "/path/to/your/project"]
    }
  }
}
```

### Windsurf

Open Settings > MCP and add:

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context", "/path/to/your/project"]
    }
  }
}
```

### Claude Code

No config file needed. Add to `.claude/settings.json` or run:

```bash
claude mcp add codebase-context -- npx -y codebase-context /path/to/your/project
```

## What Makes It a Second Brain

Other tools help AI find code. This one helps AI make the right decisions — by remembering what your team does, tracking how patterns evolve, and warning before mistakes repeat.

### Remembers

Decisions, rationale, and past failures persist across sessions. Not just what the team does — why.

- Internal library usage: `@mycompany/ui-toolkit` (847 uses) vs `primeng` (3 uses) — and _why_ the wrapper exists
- "Tried direct PrimeNG toast, broke event system" — recorded as a failure memory, surfaced before the next agent repeats it
- Conventions from git history auto-extracted: `refactor:`, `migrate:`, `fix:`, `revert:` commits become memories with zero manual effort

### Reasons

Quantified pattern analysis with trend direction. Not "use inject()" — "97% of the team uses inject(), and it's rising."

- `inject()`: 97% adoption vs `constructor()`: 3% — with trend direction (rising/declining)
- `Signals`: rising (last used 2 days ago) vs `RxJS BehaviorSubject`: declining (180+ days)
- Golden files: real implementations scoring highest on modern pattern density — canonical examples to follow
- Pattern conflicts detected: when two approaches in the same category both exceed 20% adoption

### Protects

Before an edit happens, the agent gets a preflight briefing: what to use, what to avoid, what broke last time.

- Preflight card on `search_codebase` with `intent: "edit"` — risk level, preferred/avoid patterns, failure warnings, golden files, impact candidates
- Failure memories bump risk level and surface as explicit warnings
- Confidence decay: memories age (90-day or 180-day half-life). Stale guidance gets flagged, not blindly trusted
- Epistemic stress detection: when evidence is contradictory, stale, or too thin, the preflight card says "insufficient evidence" instead of guessing

### Discovers

Hybrid search (BM25 keyword 30% + vector embeddings 70%) with structured filters across 30+ languages:

- **Framework**: Angular, React, Vue
- **Language**: TypeScript, JavaScript, Python, Go, Rust, and 25+ more
- **Component type**: component, service, directive, guard, interceptor, pipe
- **Architectural layer**: presentation, business, data, state, core, shared
- Circular dependency detection, style guide auto-detection, architectural layer classification

## Measured Results

Tested against a real enterprise Angular codebase (~30k files):

| What was measured                  | Result                                                   |
| ---------------------------------- | -------------------------------------------------------- |
| Internal library detection         | 336 uses of `@company/ui-toolkit` vs 3 direct PrimeNG   |
| DI pattern consensus               | 98% `inject()` adoption detected, constructor DI flagged |
| Test framework detection           | 74% Jest, 26% Jasmine/Karma, per-module awareness        |
| Wrapper discovery                  | `ToastEventService`, `DialogComponent` surfaced over raw |
| Golden file identification         | Top 5 files scoring 4-6 modern patterns each             |

Without this context, AI agents default to generic patterns: raw PrimeNG imports, constructor injection, Jasmine syntax. With the second brain active, generated code matches the existing codebase on first attempt.

## How It Works

The difference in practice:

| Without second brain                     | With second brain                    |
| ---------------------------------------- | ------------------------------------ |
| Uses `constructor(private svc: Service)` | Uses `inject()` (97% team adoption)  |
| Suggests `primeng/button` directly       | Uses `@mycompany/ui-toolkit` wrapper |
| Generic Jest setup                       | Your team's actual test utilities    |

### Preflight Card

When using `search_codebase` with `intent: "edit"`, `"refactor"`, or `"migrate"`, the response includes a preflight card alongside search results:

```json
{
  "preflight": {
    "intent": "refactor",
    "riskLevel": "medium",
    "confidence": "fresh",
    "evidenceLock": {
      "mode": "triangulated",
      "status": "pass",
      "readyToEdit": true,
      "score": 100,
      "sources": [
        { "source": "code", "strength": "strong", "count": 5 },
        { "source": "patterns", "strength": "strong", "count": 3 },
        { "source": "memories", "strength": "strong", "count": 2 }
      ]
    },
    "preferredPatterns": [
      { "pattern": "inject() function", "category": "dependencyInjection", "adoption": "98%", "trend": "Rising" }
    ],
    "avoidPatterns": [
      { "pattern": "Constructor injection", "category": "dependencyInjection", "adoption": "2%", "trend": "Declining" }
    ],
    "goldenFiles": [
      { "file": "src/features/auth/auth.service.ts", "score": 6 }
    ],
    "failureWarnings": [
      { "memory": "Direct PrimeNG toast broke event system", "reason": "Must use ToastEventService" }
    ]
  },
  "results": [...]
}
```

One call. The second brain composes patterns, memories, failures, and risk into a single response.

### Tip: Auto-invoke in your rules

Add this to your `.cursorrules`, `CLAUDE.md`, or `AGENTS.md`:

```
## Codebase Context

**At start of each task:** Call `get_memory` to load team conventions.

**CRITICAL:** When user says "remember this" or "record this":
- STOP immediately and call `remember` tool FIRST
- DO NOT proceed with other actions until memory is recorded
- This is a blocking requirement, not optional
```

Now the agent checks patterns automatically instead of waiting for you to ask.

## Tools

| Tool                           | Purpose                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| `search_codebase`              | Hybrid search with filters. Pass `intent: "edit"` for preflight card |
| `get_component_usage`          | Find where a library/component is used                               |
| `get_team_patterns`            | Pattern frequencies, golden files, conflict detection                |
| `get_codebase_metadata`        | Project structure overview                                           |
| `get_indexing_status`          | Indexing progress + last stats                                       |
| `get_style_guide`              | Query style guide rules                                              |
| `detect_circular_dependencies` | Find import cycles between files                                     |
| `remember`                     | Record memory (conventions/decisions/gotchas/failures)               |
| `get_memory`                   | Query memory with confidence decay scoring                           |
| `refresh_index`                | Re-index the codebase + extract git memories                         |

## Language Support

The Angular analyzer provides deep framework-specific analysis (signals, standalone components, control flow syntax, lifecycle hooks, DI patterns). A generic analyzer covers 30+ languages and file types as a fallback: JavaScript, TypeScript, Python, Java, Kotlin, C/C++, C#, Go, Rust, PHP, Ruby, Swift, Scala, Shell, and common config/markup formats.

## File Structure

The MCP creates the following structure in your project:

```
.codebase-context/
  ├── memory.json         # Team knowledge (commit this)
  ├── intelligence.json   # Pattern analysis (generated)
  ├── index.json          # Keyword index (generated)
  └── index/              # Vector database (generated)
```

**Recommended `.gitignore`:** The vector database and generated files can be large. Add this to your `.gitignore` to keep them local while sharing team memory:

```gitignore
# Codebase Context MCP - ignore generated files, keep memory
.codebase-context/*
!.codebase-context/memory.json
```

### Memory System

Patterns tell you _what_ the team does ("97% use inject"), but not _why_ ("standalone compatibility"). Use `remember` to capture rationale that prevents repeated mistakes:

```typescript
remember({
  type: 'decision',
  category: 'dependencies',
  memory: 'Use node-linker: hoisted, not isolated',
  reason: "Some packages don't declare transitive deps."
});
```

**Memory types:** `convention` (style rules), `decision` (architecture choices), `gotcha` (things that break), `failure` (tried X, failed because Y).

**Confidence decay:** Memories age. Conventions never decay. Decisions have a 180-day half-life. Gotchas and failures have a 90-day half-life. Memories below 30% confidence are flagged as stale in `get_memory` responses.

**Git auto-extraction:** During indexing, conventional commits (`refactor:`, `migrate:`, `fix:`, `revert:`) from the last 90 days are auto-recorded as memories. Zero manual effort.

**Pattern conflicts:** `get_team_patterns` detects when two patterns in the same category are both above 20% adoption with different trends, and surfaces them as conflicts with both sides.

Memories surface automatically in `search_codebase` results, `get_team_patterns` responses, and preflight cards.

**Known quirks:**

- Agents may bundle multiple things into one entry
- Edit `.codebase-context/memory.json` directly to clean up
- Be explicit: "Remember this: use X not Y"

## Configuration

| Variable                 | Default        | Description                                                                    |
| ------------------------ | -------------- | ------------------------------------------------------------------------------ |
| `EMBEDDING_PROVIDER`     | `transformers` | `openai` (fast, cloud) or `transformers` (local, private)                      |
| `OPENAI_API_KEY`         | -              | Required if provider is `openai`                                               |
| `CODEBASE_ROOT`          | -              | Project root to index (CLI arg takes precedence)                               |
| `CODEBASE_CONTEXT_DEBUG` | -              | Set to `1` to enable verbose logging (startup messages, analyzer registration) |

## Performance

This tool runs locally on your machine.

- **Initial indexing**: First run may take several minutes (e.g., 2-5 min for 30k files) to compute embeddings.
- **Subsequent queries**: Instant (milliseconds) from cache.
- **Updates**: `refresh_index` re-scans the codebase. True incremental indexing (processing only changed files) is on the roadmap.

## Links

- [Motivation](./MOTIVATION.md) — Research and design rationale
- [Changelog](./CHANGELOG.md) — Version history
- [Contributing](./CONTRIBUTING.md) — How to add analyzers

## License

MIT
