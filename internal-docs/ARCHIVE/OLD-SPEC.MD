<!-- INTERNAL DOCUMENT - Strategic vision and roadmap -->
<!-- Not for public release. See README.md for external documentation. -->


### TODO PENDING TO ANALYZE AND ASSESS IF FITS INTO SCOPE:
 USE VECTOR COSINE COMPARISON FOR AGGREGATED RERANKING? https://medium.com/@nisarg.nargund/introducing-metarag-a-new-era-of-multi-llm-retrieval-augmented-generation-26c5cd0c5a60 
---https://arxiv.org/abs/2509.09360
-- MAYBE USE CODEGEN SCORER https://github.com/angular/web-codegen-scorer?tab=readme-ov-file

# SPEC.md - Codebase-Context MCP

**Purpose**: Vision, positioning, and implementation roadmap.  
**Last Updated**: December 2025

---

## Vision: The Journey from Idea to Validated Solution

> **Intelligence Layer for Human-Led AI Development**
>
> We provide the **structured codebase intelligence** that enables AI assistants (Cursor, Copilot, Claude) to understand YOUR specific codebase patterns - not just generic framework knowledge. The human owns the thinking and design, while AI assists with implementation using evidence-based context.

### The Origin: A Persistent Pain Point (Late 2022-2024)

Working with AI coding assistants since early GitHub Copilot, a consistent pattern emerged: these tools excel at generic tasks but **lack deep understanding of specific codebases**. They suggest third-party libraries when internal wrappers exist, mix DI patterns inconsistently, and generate "vibe code" that works but violates team conventions.

**The realization**: This isn't a prompt engineering problem - it's a **context engineering** problem.

###

The Evolution from Initial MCP to Research-Backed Solution

**Month 1: Initial Implementation** - Built basic semantic search MCP "because it sounded like a nice idea"
- Simple codebase indexing and search
- No framework-specific knowledge
- Generic embeddings approach

**Month 2-3: Reality Check** - Discovered the limitations
- Semantic search returned too many irrelevant results
- No way to distinguish internal libraries from external ones
- Couldn't quantify team patterns ("we prefer X" vs "97% use X")

**Month 4-6: Deep Research** - Investigated real-world pain points
- Analyzed 15+ research papers, 9 industry sources, 3 developer surveys
- Identified THE problem: "63.3% cite lack of codebase context" (Stack Overflow 2024)
- Discovered "vibe coding" and technical debt accumulation (TheNewStack, GitClear)
- Found evidence: token costs 2-5x higher with iterative refinement (arXiv)
- Learned: Autonomous agents fail 65-85% of the time, human-in-the-loop succeeds (Thoughtworks, GitHub, CMU)

**Month 7-8: Strategic Pivot** - Rebuilt with evidence-based features
- Added Golden Files (algorithmic scoring for best examples)
- Added pattern frequency tracking (97% inject, not just "prefer inject")
- Added wrapper detection (@company/ui: 847 uses vs primeng: 3 uses)
- Added testing framework detection from actual code (not package.json)
- Focused on framework-specific depth (Angular v17+ signals, inject, standalone)

**Month 9: Competitive Differentiation** - Defined the defensible moat
- Not competing on: General codebase search (FileScopeMCP does this)
- Not competing on: External docs (Context7 does this)
- Competing on: **Framework-specific computational pattern analysis**
  - Requires deep domain expertise (Angular v17+ patterns)
  - Cannot be replicated by reading config files
  - Updates dynamically as codebase evolves

**Current: Validation Phase** - Proving the value
- Tested on enterprise-portal (611 files): inject 98%, Jest 74%, identified wrappers
- Preliminary evidence: 67% token reduction across 2 use cases
- Pending: Validation across 10+ use cases, external repos, business value quantification

### What We Provide (Honest Assessment)

| Capability | Value | Rationale |
|------------|-------|-----------|
| **Internal Library Discovery** | **UNIQUE** | Enables Agents to use `@mycompany/utils` instead of reinventing wheels. |
| **Wrapper Detection & Warnings** | **UNIQUE** | Prevents Agents from importing `primeng` when `@mycompany/ui-toolkit` is required. |
| **Context-Efficient Golden Files** | **UNIQUE** | Feeds Agents the *perfect* few-shot example to mimic style, minimizing token cost. |
| **Testing Framework Detection** | **UNIQUE** | Prevents Agents from generating Jasmine syntax in Jest projects. |
| **Evidence for Guidance** | **SUPPORTING** | Grounding data to prevent hallucinations. |

### Design Principle: Context Window Efficiency

> **"Agentic AI multi-step planning has ~30-35% success rate. Errors compound."**

Bad context -> Bad Plan -> Failed Task. Our MCP prioritizes:
- **Quality over quantity** — Accurate snippets, not random first-matches
- **One lookup** — Golden Files provide complete examples in single request
- **Actionable warnings** — "Use wrapper X instead of Y" is immediately usable

**Our Positioning:**
> "AGENTS.md tells the Agent what to do. Codebase-Context MCP gives the Agent the **eyes** to see how to do it correctly in *this specific* codebase."

---

## Critical Finding: The Market Is FRAGMENTED

> **No universal standard for AI context. Each major player has their OWN format.**

| Tool | Format | Reach |
|------|--------|-------|
| GitHub Copilot | `.github/copilot-instructions.md` | 1.8M+ paid |
| Cursor | `.cursorrules` | 35.9k stars, 65.9k members |
| Anthropic | `CLAUDE.md` | 44.7k stars |
| Windsurf | `.windsurf/rules/` | Growing |
| Aider | `CONVENTIONS.md` | Established |
| OpenAI | `AGENTS.md` | 8.8k stars (0.0047% repos) |
+ **Gemini/Claude** | **MCP (Tool Usage)** | **The Future of Agentic AI** |

**Our advantage**: Format-agnostic. We don't just "instruct" the Agent; we **empower** it with tools to look around.

---

## Competitive MCP Landscape

| MCP Tool | What It Does | Our Differentiator |
|----------|--------------|-------------------|
| **FileScopeMCP** | Dependency graphs, importance scores | We track internal library usage |
| **AI Distiller** | 90-98% code compression | We preserve patterns, not just APIs |
| **In Memoria** | Persistent patterns, AST parsing | We're framework-specific (Angular) |
| **Sequa** | Cross-repo context | We're single-repo focused |

### Our Unique Value

| Feature | Others | Us |
|---------|--------|-----|
| Internal library tracking | ❌ None | ✅ "@mycompany/utils used in 218 files" |
| Wrapper detection | ❌ None | ✅ "Use @mycompany/ui-toolkit not primeng" |
| Framework-specific | ❌ Generic | ✅ Angular v17+ (signals, inject) |
| Architectural layers | ❌ None | ✅ presentation/business/data/core |
| Testing framework detection | ❌ None | ✅ Jest vs Jasmine/Karma from code |

---

## Current Tools

| Tool | Status |
|------|--------|
| `search_codebase` | ✅ Working |
| `get_team_patterns` | ✅ Working |
| `get_component_usage` | ✅ Working |
| `get_codebase_metadata` | ✅ Working |
| `get_style_guide` | ✅ Working |

---

## Roadmap

### Phase 1.5: Quality Improvements ✅ DONE
- [x] Golden File scoring (find best example files)
- [x] componentStyle snippet extraction
- [x] Wrapper detection & recommendations
- [x] Context window efficiency improvements
- [x] Testing framework detection (Jest/Jasmine/Vitest/Cypress/Playwright)

### Phase 1.6: API Surface ✅ DONE
- [x] Surface `goldenFiles` in `get_team_patterns` response
- [x] Surface `wrapperRecommendations` in `get_team_patterns` response
- [x] Remove `get_analyzer_info` (no user value, context window waste)

### Phase 1.7: Extended Tools (Pre-Launch) 🟡 IN PROGRESS

Items validated from competitive research (see `research/02-competitive-validation.md`):

| Feature | Source | Priority | Status |
|---------|--------|----------|--------|
| File system watcher for auto-updates | code-graph-mcp | 🔴 High | ❌ Removed (see note) |
| `check_import` tool for real-time wrapper validation | Original | 🟡 Medium | ⏳ |
| `refresh_recent_files` tool for quick updates | Original | 🟡 Medium | ⏳ |
| Performance tier documentation (Fast/Moderate/Expensive) | code-graph-mcp | 🟢 Low | ⏳ |
| **External repo validation** (angular-spotify, ever-gauzy) | Public evidence | 🟡 Medium | ⏳ |
| **Token reduction quantification** (broader validation) | Credibility | 🟡 Medium |
| **LinkedIn Post** (publish and light read) | Visibility | 🟢 Low | ⏳ |

> **❌ File Watcher Removed (v1.2.1)**: Feature was implemented but caused infinite re-indexing loops. Without incremental indexing, a single file change triggered a full 7-minute re-index of the entire codebase. The feature was completely removed (not just disabled). Will be reconsidered in Phase 2 when incremental indexing is implemented.

### Phase 2: Infrastructure & Scale (Post-Launch)

| Feature | Source | Priority |
|---------|--------|----------|
| **Incremental indexing** (Merkle trees) | claude-context | 🔴 High |
| **DOUBLE CHECK: Tree-sitter integration** | Multi-language AST support | 🔴 High |
| **Multi-repo support** (Nx workspaces) | Qodo | 🟡 Medium |
| **Impact analysis** ("what would break?") | Qodo | 🟡 Medium |
| React/Vue analyzers (hooks, composition API) | Market demand | 🟡 Medium |
| **LinkedIn Article** (deep dive journey) | Marketing | 🟢 Low |

#### UX/Labeling Improvements (validated Dec 2025)

| Fix | Rationale | Priority |
|-----|-----------|----------|
| Rename `get_component_usage` → `find_import_usage` | Name implies component/class lookup, but tool searches import paths | 🟡 Medium |
| Separate `testRunner` vs `testUtilities` in data model | Jest (runner) and TestBed (utility) are complementary, not competing | 🟡 Medium |
| Add "complementary" flag for RxJS/Signals | Both coexist in modern Angular; current output implies migration | 🟢 Low |

### Phase 3: Code Health & Pattern Governance

**Motivation**: TheNewStack research identifies "vibe coding" (code that works but violates patterns) as causing technical debt. We prevent this.

| Feature | Description |
|---------|-------------|
| **`detect_anti_patterns`** | Flag constructor in 97% inject() codebase, direct primeng when wrapper exists |
| **`code_health_score`** | Pattern conformance score per file (0-100), complexity hotspots |
| **`pattern_drift_tracking`** | Track frequency over time ("inject 60% → 97%"), alert on regression |
| **Multi-step research agent** | Complex queries like "what would break if we refactor?" (from Qodo) |
| **Call graph analysis** | Callers/callees for enhanced impact analysis (from code-graph-mcp) |
| **VSCode extension** | For broader adoption (from claude-context) |

**Business Value**: Position as "governance layer" preventing AI from amplifying technical debt

---

## Architecture

```
Core (Framework-Agnostic)
├── Indexer → .codebase-intelligence.json
├── PatternDetector → patterns + canonical examples + golden files
├── ImportGraph → usage tracking with line numbers
└── LibraryUsageTracker → counts internal library imports

Angular Analyzer (Our Strength)
├── inject() vs constructor detection
├── Signals vs RxJS detection  
├── Component/Service/Directive classification
└── Canonical example selection
```

---

## Testing & Validation

> MCP effectiveness varies by model. See `tests/TESTING_FRAMEWORK.md` for evaluation methodology and `tests/TEST_RESULTS_SUMMARY.md` for findings.

### MCP Improvement Roadmap

Based on validation testing (Dec 2025):

| Issue | Priority | Solution |
|-------|----------|----------|
| **Module existence validation** | 🔴 High | Add `check_import` tool to validate imports against package.json | NOTE: DOUBLE CHECK THIS BECAUSE IMPORTS MIGHT BE FROM SUBMODULE E.G. @CODEBLUE/PRIME MIGHT HAVE PRIME/BUTTON SUBMODULE BUT NOT PRIME/DROPDOWN (IS SELECT)
| **Negative pattern examples** | 🔴 High | Add `antiPatterns` field: "Don't use: Jasmine APIs, constructor DI" |
| **Icon library detection** | 🟡 Medium | Track icon imports in usage-tracker |
| **Complementary labeling** | ✅ Fixed | Renamed "alternatives" → "alsoDetected" |

---

## Success Criteria: Human-Led AI Development

**Primary Use Case**: The **human developer** uses AI assistant (Cursor, Copilot, Claude) WITH MCP context:

1.  ✅ **Spec-Driven Development**: Developer writes spec/requirements, AI generates implementation WITH pattern context
   - Human: "Create user profile component with signals and inject"
   - MCP provides: Golden File showing signals+inject pattern together
   - AI generates: Code matching team's actual patterns (not generic examples)

2.  ✅ **Onboarding Acceleration**: Junior developer exploring unfamiliar codebase
   - Developer: "How does auth work here?"
   - MCP reveals: `@mycompany/auth` usage (38 imports), OAuth library patterns
   - Result: Developer learns internal libraries faster than reading docs

3.  ✅ **Pattern Consistency**: Developer reviewing AI-generated code
   - AI suggests: Constructor injection
   - MCP shows: "inject() used 97%, constructor is legacy (3%)"
   - Developer corrects: Uses inject() instead, maintains consistency

4.  ✅ **Wrapper Discovery**: Developer needs UI component
   - AI suggests: `import { Button } from 'primeng/button'`
   - MCP warns: "@company/ui-toolkit: 847 uses vs primeng: 3 uses"
   - Developer corrects: Uses wrapper, follows team convention

5.  ✅ **Testing Alignment**: Developer writing tests
   - AI generates: Jasmine syntax
   - MCP shows: `testingFramework: Jest (74%)`
   - Developer corrects: Uses Jest syntax, matches team tooling

**Secondary Use Case**: Supervised agentic modes (Cursor Composer, Windsurf) WITH human oversight can query MCP for pattern guidance during multi-file edits.

---

## Sources

**Research Documents** (in `/research`):
- `01-market-research.md` — Market fragmentation, format wars (AGENTS.md vs CLAUDE.md vs .cursorrules)
- `02-competitive-validation.md` — Competitive landscape & independent validation
- `03-senior-engineer-gap.md` — Core value proposition, tacit knowledge, industry quotes
- `04-stress-test-results.md` — Real validation on enterprise-portal, gaps identified
- `docs/RESEARCH_NOTES.md` — Architectural decisions backed by research

**References**:
- Stack Overflow 2024: 63.3% cite "lack of codebase context"
- GitClear 2024: AI-generated code doubled code churn
- Thoughtworks Technology Radar: 14-month tracking of agentic AI failures
- Context7: External docs (complementary)

---

*Internal document. Ready for implementation.*

