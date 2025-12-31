# TODO: Release Plan

**Current Focus**: v1.2 — Search Quality + Anti-Pattern Guidance  
**Goal**: Fix proven search contamination problem, validate existing tools, prepare for v1.3.

---

## ✅ Completed Releases

### v1.0: Discovery Layer (Released)
- Pattern frequency detection
- Internal library usage tracking
- Golden Files selection
- Testing framework detection

### v1.1: Temporal Layer (Released)
- **Pattern Momentum**: `newestFileDate` + `trend` (Rising/Stable/Declining)
- Solves the "3% Problem" — AI can distinguish legacy patterns being phased out vs new patterns being adopted
- **Files**: `src/utils/git-dates.ts`, `src/utils/usage-tracker.ts`, `src/core/indexer.ts`

---

## 🎯 v1.2: Search Quality + Pattern Guidance (IN PROGRESS)

**Key Finding from Testing (SSP_Portal_1207/1208)**:
> "MCP search results contaminated with legacy patterns. Models prioritize concrete examples over stats." (TEST_RESULTS.md)

**Goal**: Fix Search Contamination immediately. Maximum ROI, minimum complexity.

### Priority 0: CRITICAL FIXES (Immediate)

- [ ] **Fix Silent Semantic Search Failure** (LanceDB Schema)
  - **Problem**: `search_codebase` swallows "No vector column" errors and silently returns keyword-only results.
  - **Fix**: Implement Auto-Heal (drop/rebuild index on schema error) and Expose Degraded Status (`semanticAvailable: false`).

### Priority 1: Fix Search Contamination (Proven Problem)

**The Bug**: `search_codebase` returns legacy code examples due to pure keyword matching.

#### Implementation Tasks:
- [x] **1.1 Add `guidance` field to `get_team_patterns`** *(Verified Dec 29, 2025)*
  - Synthesize percentage + trend: `"USE: inject()"`, `"AVOID: constructor"`
  - **File**: `src/utils/usage-tracker.ts` (lines 313-411)

- [x] **1.2 Add `trend` + `patternWarning` to search results** *(Verified Dec 29, 2025)*
  - Flag results: `trend: "Declining"` -> `patternWarning: "Uses legacy pattern"`
  - **File**: `src/core/search.ts` (lines 298-300)

- [x] **1.3 Boost Rising patterns in search ranking** *(Verified Dec 29, 2025)*
  - +15% Boost for "Rising", -10% Penalty for "Declining"
  - **File**: `src/core/search.ts` (lines 274-280)

### v1.2 Deliverables Checklist

| # | Deliverable | Complexity | Status |
|---|-------------|--------------|--------|
| 1 | `guidance` field in `get_team_patterns` | Low | [x] |
| 2 | `trend` + `patternWarning` in `search_codebase` | Low | [x] |
| 3 | Boost Rising patterns in search ranking | Medium | [x] |
| 4 | Run v1.2 verification test session | Medium | [ ] |

---

## 🔮 v1.3: Code Health & Governance Tools (PLANNED)

> [!WARNING]
> **v1.3 is higher complexity than v1.2.** Proceed only after v1.2 validation is complete.
> Red Team risks: git streaming latency (pre-compute required), scope creep (Context vs Quality tool), and `verify_compliance` blocking UX.

**Goal**: Introduce "Active Context" tools (`get_file_health`) to warn agents about volatility and coupling.

### Priority 1: The Health Tool (`get_file_health`)
- [ ] **Streamed Git Volatility Analysis**: Robust, memory-safe `git log` streaming.
- [ ] **Circular Dependency Context**: Expose `InternalFileGraph` cycles for specific files.
- [ ] **Tool Registration**: Allow agents to query health before editing.

### Priority 2: `verify_compliance` (The Sheriff)
- [ ] **Design**: Pre-commit check integrating Health + Patterns.


### Evaluate Later (Deferred Ideas)

| Idea | Source | Notes |
|------|--------|-------|
| Virtual file validation | External report | Pre-save validation in memory. Speculative — validate need first. |
| CI/CD AI Reviewer | External report | AI reviews AI-generated PRs. Requires `verify_compliance` to work. |
| Worker thread parallelization | smart-coding-mcp | Faster indexing. Evaluate if users report slow indexing. |
| fdir instead of glob | smart-coding-mcp | Claims 3-5x faster. Low-risk perf improvement. |
| Watch mode (chokidar) | smart-coding-mcp | Incremental indexing. Already on README roadmap. |
| **Intent Indexing** | [DeepCodeSeek](https://arxiv.org/abs/2509.25716) | Tag components with keywords from commit history. Improves semantic recall for discovery. Requires v1.3 git infra. **Caveat:** Test results show agents prioritize concrete examples over metadata, so improved discovery may not translate to improved conformance. |
| **How-To Expansion** | [DeepCodeSeek](https://arxiv.org/abs/2509.25716) | Append real usage snippets to search results. **Caveat:** Tests show agents already copy examples; the problem is example *quality* (legacy code), not *availability*. May have marginal value if combined with trend filtering. |

---

## Track D: Future (Post v1.3)

- [ ] **D1. Session/Decision Indexing** — Capture "Why" alongside "What"
- [ ] **D2. CI/CD Integration** — `npx codebase-governance verify`
- [ ] **D3. Golden Path Grading** — Score files against canonical examples

---

## ✅ Completed (Archived)

- [x] Pivot Strategy Formulated (DORA/Radar backed)
- [x] Documentation Reframed (SPEC.md)
- [x] Technical Issues Resolved (Logs, Schema, etc.)
- [x] Pattern Momentum implemented (v1.1)
- [x] InternalFileGraph + detect_circular_dependencies built

---

## Notes

**TODO: MIGRATE TO PNPM!!**

*Last updated: December 2025*
