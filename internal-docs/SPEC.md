<!-- INTERNAL DOCUMENT - Strategic vision and roadmap -->
<!-- Not for public release. See README.md for external documentation. -->

# SPEC.md - Codebase-Context MCP

**Purpose**: Vision, honest capabilities, and roadmap.  
**Last Updated**: December 2025

---

## 1. Vision

> **Active Context & Stability Layer for AI-Assisted Development**

We provide **Active Context**—structured evidence about *how* a codebase works (Patterns) and **Wisdom** about *where* it is fragile (Health)—to ensure AI Agents drive stability, not chaos.

**Core Insight**: AI tools are powerful engines (Throughput) but lack a steering wheel (Governance). Static instructions (AGENTS.md) provide the destination, but MCP provides the **Map (Context)** and the **Compass (Trends/Health)** to get there safely.

**The Relationship**: AGENTS.md + MCP = Intent + Reality.
- AGENTS.md: "We want to use Signals."
- MCP: "Actually, 90% of the code is RxJS, and this file is a high-churn hotspot. Be careful."

---

## 2. Capabilities & Honest Assessment

### What Works ✅ (Validated)

| Capability | Evidence | Status |
|------------|----------|--------|
| **Pattern frequency quantification** | "97% inject()" vs just "prefer inject()" | ✅ Unique |
| **Internal library discovery** | Finds @company/* usage automatically | ✅ Unique |
| **Golden Files** | Algorithmic selection of canonical examples | ✅ Unique |
| **Testing framework detection** | Jest vs Jasmine from actual code | ✅ Unique |
| **Pattern Momentum** | Rising/Declining trends from git history | ✅ Unique (v1.1) |

### What We Learned (From Testing)

| Finding | Evidence | Implication |
|---------|----------|-------------|
| AGENTS.md is effective | -MCP runs achieved correct patterns from static instructions alone | MCP should complement, not replace, static files |
| MCP adds discovery value | +MCP found `input()` + `effect()` patterns, informed location choice | Discovery is our wedge |
| Search can contaminate | 1207 test: model copied legacy code from search results | v1.2 must fix this |
| Run variance is significant | Same config, different quality between runs | Single tests are directional, not proof |
| Models don't always use tools | Some +MCP runs had zero tool calls | May need AGENTS.md prescription |

### What Didn't Work

| Feature | Problem | Status |
|---------|---------|--------|
| Simple `quickGuidance` | The "3% problem" — can't infer intent from frequency alone | Solved by Pattern Momentum (v1.1) |
| `detect_anti_patterns` (Blocking) | Active blocking created too much friction without nuance | Pivoted to "Contextual Warning" (v1.2) |
| Hard Governance ("Police") | "Stopping" the user is annoying. "Guiding" the user is helpful. | Repositioned as "Active Context" |

---

## 3. Roadmap

### v1.0: Discovery Layer (Released ✅)
- Pattern frequency detection
- Internal library usage tracking
- Golden Files selection
- Testing framework detection

### v1.1: Temporal Layer (Released ✅)
- **Pattern Momentum**: `newestFileDate` + `trend` (Rising/Stable/Declining)
- Solves the "3% Problem" — AI can distinguish legacy patterns being phased out vs new patterns being adopted

### v1.2: Search Quality + Anti-Pattern Guidance (In Progress 🔄)

**Focus**: Fix proven search contamination problem.

**Deliverables**:

| # | Feature | Description |
|---|---------|-------------|
| 1 | `guidance` field in `get_team_patterns` | Synthesizes percentage + trend into actionable advice (e.g., "USE: inject()", "AVOID: constructor injection") |
| 2 | `trend` + `patternWarning` in `search_codebase` | Each result shows trend; declining patterns get warning field |
| 3 | **Pattern Status Metadata** | Add `status: "primary" \| "legacy" \| "preferred"` to patterns. Solves the 70% vs 30% problem. |
| 4 | Boost Rising patterns in search | +15% score for Rising, -10% for Declining (don't hide, just rank) |
| 5 | Validate `detect_circular_dependencies` | Test existing tool in validation session — determine best fit (agentic, CI/CD, or audit) |
| 6 | Updated Testing Framework | New metrics: anti-pattern avoidance, trend awareness, guidance compliance |
| 7 | Validation Test Session | SSP_Portal with v1.2 features, compare to 1207/1208 baseline |

**Success Criteria**:
- Models cite `guidance` field in reasoning
- Reduced legacy pattern copying vs 1207/1208 baseline
- Clear signal on whether `detect_circular_dependencies` is useful

### v1.3: Precision Context + Governance (Planned 📋)

**Prerequisites**: v1.2 validation complete.

> [!CAUTION]
> **Technical Risks Identified (Red Team Review Dec 2025)**
> - `get_file_health` streaming `git log --numstat` at query-time will timeout on large repos (50k+ commits = 10-30s). **Requires caching strategy**.
> - `verify_compliance` as PASS/FAIL creates blocking UX. Consider `preview_compliance` (advisory) instead.

| Feature | Description |
|---------|-------------|
| **Micro-Span Returns** | Return 5-15 relevant lines instead of full chunks |
| **`isModernPattern` flag** | Tag search results based on Pattern Momentum |
| **Incremental Indexing** | Handle "Session Drift" by re-indexing modified files in memory. |
| **Local Context Resolution** | Resolve patterns per-directory (e.g., "This specific lib uses Jasmine, even if Repo uses Jest"). |
| **`verify_compliance` tool** | PASS/FAIL validation for pending changes (if v1.2 testing shows need) |
| **Budget-aware assembly** | Prefer modern examples when multiple matches exist |

**Decision Point**: If `detect_circular_dependencies` proves useless in v1.2 testing, fold it into `verify_compliance`.

### Post v1.3: Future Considerations

| Feature | Notes |
|---------|-------|
| CI/CD Integration | `npx codebase-governance verify` in pipelines |
| Session/Decision Indexing | Capture "Why" alongside "What" |
| Golden Path Grading | Score files against canonical examples |

---

## 4. Evaluate Later (Parked Ideas)

*Ideas observed in competitor projects or external reports. Not prioritized—evaluate when relevant.*

| Idea | Source | Notes | Evaluate When |
|------|--------|-------|---------------|
| Worker thread parallelization | smart-coding-mcp | Faster indexing | Users report slow indexing |
| fdir instead of glob | smart-coding-mcp | Claims 3-5x faster file discovery | Low-risk perf improvement |
| Watch mode (chokidar) | smart-coding-mcp | Incremental indexing | Already on README roadmap |
| Memory/knowledge system | Context-Engine, Cognimemo, **MCP-Memory** | Session knowledge persistence. Research how Copilot Memory, Claude Skills, Gemini Memory, and `mcp-memory` handle it. | Post-v1.2 (Dec 2025 idea) |
| Qdrant vector backend | Context-Engine | Scalability | Multi-repo use cases |
| VS Code extension | Context-Engine | Adoption friction reduction | After usage grows |
| Virtual file validation | External AI report | Pre-save validation in memory | After v1.3 testing |
| CI/CD AI Reviewer | External AI report | AI reviews AI-generated PRs | After `verify_compliance` works |

---

## 5. Competitive Positioning

| Tool | Focus | Our Unique Value |
|------|-------|------------------|
| **AGENTS.md** | Static Rules (intent) | We provide *evidence* (reality) + *temporal trends* |
| **Context7** | External Docs | We analyze *internal code* |
| **code-graph-mcp** | Generic structure | We detect *framework-specific patterns* |
| **smart-coding-mcp** | Semantic search | We add *pattern governance* + *trend awareness* |
| **Context-Engine** | Retrieval stack | We focus on *actionable guidance*, not just retrieval |

**Our Niche**: Pattern discovery + temporal trends for AI code generation. Not just "find code" — "find the *right* code."

---

*Internal document. Updated December 2025.*
