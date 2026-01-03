# AI Agent Protocol

This document defines the rules of engagement for AI agents working on the `codebase-context` project.

## 1. Documentation Source of Truth

**Rule**: All internal documentation (`SPEC`, `TODO`, `DECISION_LOG`, Architecture Reports) is mastered in **Notion**.

- **READING**: When asked for context, specs, or roadmap, you MUST use the **Notion MCP** to read from the "Codebase Context MCP" parent page.
- **WRITING**: When creating new logs or updating specs, you MUST write to Notion first.
- **Why**: This ensures documentation is accessible across machines (Personal/Work) despite DLP restrictions.

**Fallback**: If Notion is unavailable (API error), read from `internal-docs/` but warn the user that it might be stale.

## 2. Core Principles
- **Respect Patterns**: Always check `get_team_patterns` before generating code.
- **No Shadow Logic**: Do not bypass `AnalyzerRegistry` or core architectural layers (see `fork-analysis` in Notion).
