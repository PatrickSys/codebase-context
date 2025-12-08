# codebase-context-mcp

**The "missing cortex" for AI coding agents.** Internal library discovery, wrapper detection, and evidence-backed patterns—the context that `AGENTS.md` can't provide.

---

## The Problem

AI coding assistants (Copilot, Cursor, Claude) can generate instruction files (`AGENTS.md`, `.cursorrules`). They analyze your code and extract conventions. Impressive.

**But they can't tell the AI about your internal libraries.**

Your team wraps Material with `@company/ui-components`. You have utilities at `@company/utils`. The AI has no way to know these exist—they're not in any Angular doc or Stack Overflow answer. So it suggests `@angular/material/button` when it should suggest `@company/ui-components/button`.

That's the gap we fill.

---

## What We Provide

### 1. Internal Library Discovery

Other tools find where things are **defined**. We find where things are **used**.

```bash
get_component_usage("@mycompany/ui-toolkit")
# → "usageCount": 847, "usedIn": [...]
```

The AI now knows: this library exists and is heavily used. Combined with tsconfig paths (which we also expose), the AI can infer it's internal.

### 2. Wrapper Detection (AI-Inferred)

We expose raw usage data that lets the AI infer wrapper relationships:

```json
{
  "topUsed": [
    { "source": "@mycompany/ui-toolkit", "count": 847 },
    { "source": "primeng", "count": 3 }
  ],
  "tsconfigPaths": {
    "@mycompany/*": ["libs/*"]
  }
}
```

The AI sees: `@mycompany/ui-toolkit` is used 847x vs `primeng` at 3x, and `@mycompany/*` maps to local code. It infers `@mycompany/ui-toolkit` is the preferred wrapper.

### 3. Golden Files (Context Window Efficiency)

Instead of the AI doing multiple searches—"find inject usage... find signals... find standalone..."—we provide ONE file that demonstrates all patterns together.

```json
{
  "file": "settings.component.ts",
  "score": 5,
  "patterns": { "inject": true, "signals": true, "effect": true, "standalone": true }
}
```

One file. All patterns. Minimal tokens. No Frankenstein code.

### 4. Testing Framework Detection

We detect your actual testing stack from code patterns, not just `package.json`:

```json
{
  "testingFramework": { "primary": "Jest", "frequency": "100%" },
  "testMocking": { "primary": "Jest mocks", "frequency": "87%" }
}
```

No more Jasmine syntax in a Jest project.

---

## Relationship with AGENTS.md

| | AGENTS.md | codebase-context-mcp |
|---|---|---|
| **Provides** | What team *wants* (guidance) | What team *does* (evidence) |
| **Internal libraries** | ❌ Can't discover | ✅ Tracks usage counts |
| **Canonical examples** | ❌ Describes rules | ✅ Finds real implementations |
| **Format** | Prose | Structured JSON |

**They're complementary. Use both.**

AGENTS.md tells the AI what you *want*. We show what you *actually do*—and surface the internal libraries and examples that no doc can provide.

---

## Tools

| Tool | What It Does |
|------|--------------|
| **`get_component_usage`** | Find WHERE a library/component is used ("Find Usages") |
| **`get_team_patterns`** | Pattern frequencies + canonical examples + golden files |
| `search_codebase` | Semantic + keyword hybrid search |
| `get_codebase_metadata` | Project structure + patterns summary |
| `get_style_guide` | Style guide content lookup |
| `get_indexing_status` | Index state and progress |
| `refresh_index` | Re-index the codebase (supports `incrementalOnly: true` for Phase 2) |



---

## Architecture

```
┌───────────────────────────────────────────────────────┐
│            codebase-context-mcp (Core)                │
│  • Hybrid search (semantic + keyword)                 │
│  • Import graph (who uses what)                       │
│  • tsconfig paths extraction                          │
│  • Golden file discovery                              │
└──────────────────────────┬────────────────────────────┘
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
 Angular Analyzer    [Future: React]    Generic Analyzer
 (DI patterns,        (hooks, state,   (TS/JS fallback)
  Signals, etc.)       components)
```

**Pluggable analyzer architecture** with a generic base:

- **Generic Analyzer**: Handles any JS/TS project (import graph, patterns, usage tracking). For other languages (Python, Go, Rust), basic chunking works but deep pattern detection requires dedicated analyzers.
- **Angular Analyzer**: Specialized patterns (inject, signals, standalone, etc.)
- **Future**: React, Vue analyzers planned; tree-sitter integration for true multi-language AST support.

> **Current focus**: JS/TS codebases with Angular as the primary specialized analyzer. The architecture is designed to be language-agnostic with pluggable analyzers—that's the mid-term vision.

---

## Setup

### Install from npm

```bash
npm install -g codebase-context-mcp
```

Or use with npx (no install needed):

```bash
npx codebase-context-mcp /path/to/your/project
```

### Configure in your MCP client (e.g., Claude Desktop)

```json
{
  "codebase-context-mcp": {
    "command": "npx",
    "args": ["codebase-context-mcp", "/path/to/your/project"]
  }
}
```

Or if installed globally:

```json
{
  "codebase-context-mcp": {
    "command": "codebase-context",
    "args": ["/path/to/your/project"],
    "env": {
      "EMBEDDING_PROVIDER": "openai",
      "OPENAI_API_KEY": "sk-..."
    }
  }
}
```

### Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_PROVIDER` | `transformers` | Set to `openai` to use OpenAI's API (faster, lighter) or `transformers` for local (private, free). |
| `OPENAI_API_KEY` | - | Required if provider is `openai`. |

**Why use OpenAI?**
- **Faster**: No need to download/run local 100MB+ models.
- **Lighter**: Significantly less RAM usage for the MCP server.
- **Cost**: `text-embedding-3-small` is extremely cheap ($0.02 per 1M tokens), but technically not free like local.

---

## What We Don't Do

We stay focused. Here's what we deliberately exclude:

| Feature | Why Not | Who Does It |
|---------|---------|-------------|
| Infer "preferred" vs "legacy" | Requires team input | Your AGENTS.md |
| Cross-repo context | Scope creep | Sequa |
| Code violation detection | Different niche | ESLint, CodeScene |
| External library docs | Different problem | Context7 |

---

## Known Limitations

| Limitation | Status | What to do about it |
|------------|--------|---------------------|
| **Deep patterns are JS/TS only** | MVP | Generic analyzer handles any language for search/chunking, but real AST-based pattern detection uses TypeScript parser. Tree-sitter integration planned for multi-language support. |
| **Specialized patterns are Angular-only** | MVP | React/Vue specialists are planned. The pluggable architecture makes this extensible. |
| **Single repo** | MVP | Multi-repo (Nx workspaces) planned. For now, point it at one repo at a time. |
| **Pattern frequency ≠ correctness** | By design | We show team consensus, not "right" patterns. 97% inject() usage doesn't mean inject() is correct—it means that's what your team does. Combine with AGENTS.md for intent. |
| **Index goes stale** | MVP | Re-index manually with `refresh_index` or restart the MCP. Incremental indexing planned for Phase 2. |
| **First index can be slow** | Depends | Uses local embeddings by default (downloads ~100MB model). Use `EMBEDDING_PROVIDER=openai` for faster startup if privacy isn't a concern. |


---

## Why This Exists

📄 **[Motivation](./MOTIVATION.md)** - The research and pain points that led to this

## License

MIT
