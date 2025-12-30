# codebase-context: Strategic Decision & Research Log

> **Purpose**: A comprehensive, **unbiased** record of strategic decisions, research findings, and the full chain of reasoning (Premise → Evidence → Conclusion). This document serves as the single source of truth to prevent strategic drift and circular conversations.
>
> **Maintainer**: Internal
> **Last Updated**: December 28, 2025

---

## Table of Contents
1.  [Project Genesis & Core Identity](#1-project-genesis--core-identity)
2.  [The "3% Problem" & Its Resolution](#2-the-3-problem--its-resolution)
3.  [The "Discovery vs. Governance" Pivot](#3-the-discovery-vs-governance-pivot)
4.  [Market Positioning: AGENTS.md & Fragmentation](#4-market-positioning-agentsmd--fragmentation)
5.  [DORA & The Stability Paradox](#5-dora--the-stability-paradox)
6.  [Test Session Findings & Learnings](#6-test-session-findings--learnings)
7.  [Competitive Landscape & Unique Value](#7-competitive-landscape--unique-value)
8.  [Known Blind Spots & Gaps](#8-known-blind-spots--gaps)
9.  [Design Pattern Intelligence (Strategic Direction)](#9-design-pattern-intelligence-strategic-direction)
10. [Roadmap & Release History](#10-roadmap--release-history)
11. [How Major Players Handle Context](#11-how-major-players-handle-context-december-2025)
12. [Common AI Failure Patterns in Enterprise](#12-common-ai-failure-patterns-in-enterprise-december-2025)
13. [Key Artifacts Index](#13-key-artifacts-index)

---

## 1. Project Genesis & Core Identity

### 1.1 The Problem Statement
**Premise (Industry Data)**:
*   **63.3%** of developers cite "AI tools lack context of codebase" as their #1 challenge (Stack Overflow 2024).
*   AI agents like Devin have a **15-35% task success rate** (Answer.AI, METR Studies).
*   Codebases carry "tacit knowledge"—design rationales, historical trade-offs, team conventions—that exists only in developers' heads (arXiv:2503.07967, Code Digital Twin).

**Premise (Direct Observation)**:
*   A "generic AI" generating code for a real codebase (SSP_Portal) produced:
    *   Constructor injection instead of `inject()` (98% team pattern).
    *   Raw PrimeNG instead of internal wrappers (`@mycompany/prime`).
    *   Jasmine syntax instead of Jest (team testing framework).

**Conclusion**: AI tools are powerful but lack the "Senior Engineer Knowledge" needed to produce architecturally correct code in a specific codebase. The missing piece is **structured codebase intelligence**, not just file content retrieval.

### 1.2 The Original Vision: "Automated Governance"
The project was initially conceived as an "Automated Governance" layer (a "Sheriff") that would actively block anti-patterns.

**Why It Failed (Initially)**:
*   **The "3% Problem"** (See Section 2): Pure statistical observation cannot infer intent. A pattern used 3% of the time could be the *new* standard or *deprecated* legacy.
*   **Friction**: Active blocking was perceived as "annoying," not "helpful."

**The Pivot**: The project repositioned from "Governance" to "Discovery" (v1.0) and "Context" (v1.1+), with Governance features (like `guidance`) planned for later phases.

---

## 2. The "3% Problem" & Its Resolution

### 2.1 The Core Logic Trap
**Premise**: A codebase is migrating from RxJS (70% usage) to Signals (30% usage).

**Naive MCP Output**: "Use RxJS (Dominant). Avoid Signals (Minority)." ❌

**Truth**: "Use Signals (Target). RxJS is Legacy."

**Conclusion**: **Frequency ≠ Intent.** Pure statistical observation identifies "majority" as "correct," which is wrong during a migration.

### 2.2 The Resolution: Pattern Momentum (v1.1)
**The Solution**: Introduce a **temporal** dimension.
*   **`newestFileDate`**: The date of the most recent file using this pattern.
*   **`trend`**: Calculated as `Rising`, `Stable`, or `Declining`.

**New Output**:
```json
{
  "name": "Signals",
  "usage": "30%",
  "trend": "Rising",
  "newestFileDate": "2025-12-15"
}
```

**Evidence of Validity (Web Research)**:
*   "*Pattern Momentum* refers to the observed trends and adoption rates of specific coding patterns... AI agents can then use to inform their migration strategies." (Google Search, Dec 2025, citing github.com source).
*   The "Grounding First, Then Generate" (GFTG) pattern in academic research (arXiv:2510.10290) validates that **deterministic, quantified signals** prevent hallucination.

**Status**: ✅ **Implemented in v1.1.**

---

## 3. The "Discovery vs. Governance" Pivot

### 3.1 The Original Ambition
The project started with an ambition for "Active Governance"—a "Sheriff" that would detect and block anti-patterns.

### 3.2 Why Governance Failed (at MVP Stage)
| Reason | Evidence |
|---|---|
| **Blocking is "Too Friction"** | Gemini Deep Research Feedback: "Hard blocking created too much friction without nuance." |
| **The 3% Problem** | We could not infer *intent* from *frequency* alone. See Section 2. |
| **Models Don't Always Use Tools** | SSP_Portal tests: Some +MCP runs had **zero tool calls**. The model ignored the MCP. |

### 3.3 The Pivot Decision
> **"Accept the Pivot: Position as 'Discovery Layer' for now."** — `CONVERSATION_20251208.md`

**The New Strategic Stance**:
> "MCP is the Map. AGENTS.md is the Law. They are complementary."

**Rationale**:
*   **AGENTS.md** = Intent (what the team *wants*). Static, aspirational.
*   **MCP** = Reality (what the team *does*). Dynamic, evidence-based.
*   The MCP provides the **evidence** that helps AI follow the **intent** set in static files.

**Status**: ✅ **Adopted. v1.0 positioned as "Discovery Layer."**

---

## 4. Market Positioning: AGENTS.md & Fragmentation

### 4.1 Initial Overstatement (Challenged)
An initial internal claim was: "AGENTS.md is becoming THE industry standard."

### 4.2 The Challenge (Research Correction)
**Evidence** (`01-market-research.md`):
*   AGENTS.md is used by **20,000 repos** out of **420+ million** total on GitHub (0.0047%).
*   **The largest players each have their OWN format:**
    *   GitHub Copilot: `.github/copilot-instructions.md`
    *   Anthropic Claude: `CLAUDE.md`
    *   Cursor: `.cursorrules` (**35.9k stars** on the awesome-list)
    *   Windsurf: `.windsurf/rules/*.md`
*   GitHub Copilot explicitly supports CLAUDE.md, GEMINI.md, and AGENTS.md as equals.

### 4.3 Revised Conclusion
> **"My original claim that AGENTS.md is 'becoming THE industry standard' was incorrect."** — `01-market-research.md`
>
> The accurate assessment is: **The AI coding agent context landscape is FRAGMENTED, not standardized.**

### 4.4 Strategic Implication for MCP
The fragmentation is **good news**.
*   The MCP is **format-agnostic**.
*   It works alongside ANY static instruction file (AGENTS.md, CLAUDE.md, .cursorrules).
*   It fills the gap that **none** of these static formats address: **dynamic, runtime codebase intelligence**.

---

## 5. DORA & The Stability Paradox

### 5.1 Key Findings from DORA 2025 (`08-ai-dora-technology-radar-summary.md`)
| Statistic | Implication |
|---|---|
| **90%** AI Adoption | AI is ubiquitous; adoption is not a differentiator. |
| **30%** of devs have "little to no trust" in AI output | High usage does not mean high trust. |
| **39% Gap** between perceived (+20%) and actual (-19%) efficiency | The "Efficiency Illusion": Developers *feel* faster but are objectively slower due to debugging AI hallucinations. |
| **Flat/Negative** correlation between AI and performance **without** High-Quality Platforms | Platform Engineering (Golden Paths) is the gatekeeper for AI success. |
| **7%** of teams are "Cluster 4" (High Impact, High Instability) | AI enables juniors to write senior-level *complexity* without senior-level *stability*. |

### 5.2 The "Stability Paradox"
**Premise**: AI increases Throughput (Speed).
**Observation**: AI also increases Instability (Bugs).

**Conclusion**: The solution is not more AI; the solution is **Governance**—providing the AI with guardrails (Golden Paths, Pattern Context) that steer it toward stable, correct output.

### 5.3 Alignment with MCP Vision
*   The MCP's Pattern Quantification ("97% inject()") serves as a **"Golden Path" for code patterns**.
*   The `guidance` field (v1.2) will provide the **"Actionable Decision"** that DORA research says developers need.

---

## 6. Test Session Findings & Learnings

### 6.1 Summary of Tests (`TEST_RESULTS_SUMMARY.md`, `00-test-cases.md`)
| Session | Model | MCP | Build | Patterns | Key Learning |
|---|---|---|---|---|---|
| SSP_Portal_1207 | Grok Code | ✅ | ❌ | 2/5 | **Hallucination**: Invented modules despite MCP data. |
| SSP_Portal_1207 | GPT-5 Mini | ❌ | ✅ | 4/5 | **AGENTS.md Effective**: Correct patterns from static instructions alone. |
| SSP_Portal_1207 | GPT-5 Mini | ✅ | ✅ | 5/5 | **MCP Additive**: +15% tokens, but better patterns. |
| SSP_Portal_1207 | Gemini 3 Pro | ❌ | ⚠️ | 0/5 | **Worst Case**: Constructor DI, no signals, no libs. Zero codebase awareness. |
| SSP_Portal_1207 | Gemini 3 Pro | ✅ +GEMINI.md | ✅ | 5-6/8 | **GEMINI.md Highly Effective**: Static instructions achieved 75% conformance. |
| SSP_Portal_1208 | GPT 5.1-High | ❌ | ❌ | 3/5 | +MCP guided to `libs/ui` location and found `input()` pattern. |
| SSP_Portal_1208 | GPT 5.1-High | ✅ | ✅ | 5/5 | **MCP Discovery Value**: Found modern patterns and better locations. |

### 6.2 Key Learnings (Aggregated)
| Finding | Evidence | Implication |
|---|---|---|
| **AGENTS.md is effective on its own.** | Gemini +GEMINI.md run achieved 75% conformance. | MCP should **complement**, not replace, static files. |
| **MCP adds discovery value.** | +MCP runs found `input()` + `effect()` patterns, informed location choice. | The MCP's wedge is **discovery**, not governance. |
| **Search can contaminate.** | 1207 test: model copied legacy code from search results. | v1.2 MUST add `trend` and `patternWarning` to search results. |
| **Run variance is significant.** | Same config, different quality between runs. | Single tests are directional, not proof. |
| **Models don't always use MCP tools.** | Some +MCP runs had zero tool calls (especially in WSL). | May need an `AGENTS.md` line *prescribing* MCP tool usage. |

### 6.3 The "GPT-5.1 Paradox" (Visual Blindness)
**Observation** (`GEMINI-DEEP-RESEARCH-FEEDBACK.MD`):
*   **-MCP**: Model correctly guessed `CodeBlue` UI components (from training data).
*   **+MCP**: Model reverted to native HTML (`<select>`) and hardcoded CSS.

**Root Cause**: The MCP established itself as the authority. It provided detailed info on *services* but **zero** info on *UI components*. The model interpreted the silence as "no design system exists."

**Conclusion (Critical Blind Spot)**: **Incomplete governance is worse than no governance.** The MCP needs a `get_ui_components` or `get_design_tokens` capability to avoid the "Vacuum of Authority" problem.

---

## 7. Competitive Landscape & Unique Value

### 7.1 The Crowded Market (`10-mcp-competitive-research.md`)
Most MCPs solve the same problem: **Semantic code search via embeddings/vector DB**.

### 7.2 Our Unique Niche
**"Pattern Intelligence for AI Coding"** — We are the **ONLY** MCP that:
1.  **Quantifies pattern frequencies** ("97% use inject()")
2.  **Detects pattern trends** ("Rising" / "Declining")
3.  **Algorithmically selects Golden Files**
4.  **Discovers internal libraries automatically**

### 7.3 Competitive Matrix
| Capability | Us | Qodo | code-graph-mcp | claude-context | AGENTS.md |
|---|:---:|:---:|:---:|:---:|:---:|
| Pattern frequency ("97% inject") | ✅ | ❌ | ❌ | ❌ | ❌ |
| Wrapper detection | ✅ | ❌ | ❌ | ❌ | ❌ |
| Golden Files | ✅ | ❌ | ❌ | ❌ | ❌ |
| Framework-specific patterns | ✅ | ❌ | ❌ | ❌ | N/A |
| Testing detection | ✅ | ❌ | ❌ | ❌ | ❌ |
| Semantic search | ✅ | ✅ | ❌ | ✅ | N/A |
| **Private/local** | ✅ | ❌ | ✅ | ⚠️ | ✅ |

### 7.4 What NOT to Build
*   Generic semantic search (saturated).
*   LSP integration (Serena owns this).
*   Diagram generation (blueprint-mcp owns this).
*   SaaS/cloud-hosted (CodeAlive owns this).

---

## 8. Known Blind Spots & Gaps

### 8.1 Visual / UI Layer Blindness (CRITICAL)
**Problem**: The MCP governs services and DI patterns but has **zero** visibility into UI components, design tokens, or CSS patterns.
**Evidence**: "GPT-5.1 Paradox" in testing.
**Status**: 🔴 Unresolved.
**Proposed Solution**: A `get_ui_components` or `get_design_tokens` tool (v1.3+).

### 8.2 Local Context Resolution
**Problem**: Global stats ("74% Jest") are insufficient for mixed codebases. Local directories may differ.
**Evidence**: Stress Test: "MCP shows Jest as primary; this is acceptable for *new* code" but doesn't help an agent working in a legacy Jasmine folder.
**Status**: 🟡 Identified. Planned for v1.3.

### 8.3 Index Staleness / "Session Drift"
**Problem**: During long refactoring sessions, the MCP's index becomes stale as files are modified.
**Evidence**: Manual observation.
**Status**: 🟡 Identified. Incremental Indexing planned for v1.3.

### 8.4 `measure_churn_prototype.cjs` Limitations
**Problem**: The churn prototype conflates "Good Churn" (refactoring legacy code) with "Bad Churn" (thrashing on new code). It labels refactoring as "unhealthy."
**Evidence**: `09-dora-ai-churn-gaps.md` — a 25,000-word critique of the script.
**Status**: 🔴 The prototype is **not production-ready**. Requires `git blame` integration to distinguish churn types.

---

## 9. Design Pattern Intelligence (Strategic Direction)

> **Status**: 🔮 **Future Vision** (Not yet implemented)
> **Source**: User feedback (Dec 2025), AI Failure Log analysis

### 9.1 The Hypothesis
**Current State**: The MCP detects **team-specific** patterns (e.g., "97% use `inject()`").

**Proposed Evolution**: Extend to detect **canonical design patterns**—both generic and technology-specific.

| Pattern Type | Examples |
|---|---|
| **Generic** | Singleton, Factory, Observer, MVC, Repository |
| **Angular-Specific** | Signals, Standalone Components, Functional Guards, `input()` vs `@Input()` |
| **React-Specific** | Hooks, Server Components, Context API, Zustand vs Redux |
| **Enterprise** | API Gateway, Circuit Breaker, Event Sourcing |

### 9.2 Two-Phase Application

| Phase | Tool | Action |
|---|---|---|
| **Development** | `get_team_patterns` | "This codebase uses **Signal-based state management**. Generate `signal()`, not `BehaviorSubject`." |
| **CI/CD (v1.3+)** | `verify_compliance` | "This PR uses `@Input()` decorator, but the codebase is 88% `input()` signals. **Flag for review**." |

### 9.3 Implementation Approaches (Trade-offs)

| Approach | Pros | Cons |
|---|---|---|
| **Hardcoded Taxonomy** | Deterministic, fast, no hallucination | Limited to known patterns; requires manual updates |
| **LLM-Based Inference** | Flexible, discovers unknown patterns | Expensive per-call, less deterministic, hallucination risk |
| **Hybrid** | Best of both; use hardcoded for known, LLM for edge cases | Complexity; two code paths to maintain |

### 9.4 Validation Before Building
**Risk**: "Design Pattern Detection" is a **large scope expansion**.

**Validation Method**: Use `11-portal-ai-failure-log.md` to collect concrete evidence of AI failures related to design patterns. If failures are frequent and consistent, the feature is validated. If failures are rare, deprioritize.

**Current Evidence** (`11-portal-ai-failure-log.md`):
- Failure #005: AI used `BehaviorSubject` instead of `signal()` → **Pattern Momentum solved this** (v1.1).
- Failure #003: AI used native HTML instead of design system → **UI Blindness** (needs `get_ui_components`).

**Conclusion**: Design Pattern Intelligence is **partially validated**. Pattern Momentum addresses "modernity" (Rising/Declining). UI/Design System patterns remain a gap.

---

## 10. Roadmap & Release History

### 10.1 Releases
| Version | Focus | Status |
|---|---|---|
| **v1.0** | Discovery Layer (Patterns, Libs, Golden Files) | ✅ Released |
| **v1.1** | Temporal Layer (Pattern Momentum: `trend`, `newestFileDate`) | ✅ Released |
| **v1.2** | Search Quality + Guidance (`guidance`, `patternWarning`, search boosting) | 🔄 In Progress |
| **v1.3** | Precision Context + Governance (`get_file_health`, `verify_compliance`, Incremental Indexing, Local Context) | 📋 Planned |

### 10.2 v1.2 Deliverables (Current Focus)
1.  `guidance` field in `get_team_patterns`
2.  `trend` + `patternWarning` in `search_codebase`
3.  Boost Rising patterns in search ranking
4.  Validate `detect_circular_dependencies`
5.  Run v1.2 verification test session

---

## 11. How Major Players Handle Context (December 2025)

This section documents how each major AI coding tool handles codebase context and instructions.

### 11.1 OpenAI Codex CLI
| Feature | Details |
|---------|---------|
| **Primary Config** | `~/.codex/config.toml` (TOML file). |
| **Instruction File** | Agent searches for `AGENTS.md` in the repo. |
| **Profiles** | Define multiple config profiles (e.g., `--profile frontend`) for different projects. |
| **Sandboxing** | `sandbox_mode`: `read-only`, `workspace-write`, `danger-full-access`. |
| **Approval Policy** | `suggest` (default), `auto-edit`, `full-auto`. |
| **Multimodal** | `-i screenshot.png` for visual context. |

### 11.2 GitHub Copilot
| Feature | Details |
|---------|---------|
| **Primary Config** | `.github/copilot-instructions.md` (Markdown in repo root). |
| **Alternatives** | Supports `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` as equals. |
| **Organization Rules** | Org-wide custom instructions for company-wide standards. |
| **Copilot Spaces** | Collaborative "context hubs" aggregating code, docs, issues. Public sharing since Dec 2025. |
| **Copilot Memory** | (Public Preview Dec 2025) Learns from codebase over time, building repo-specific memory. |
| **MCP Support** | Dynamically feeds Copilot context via Model Context Protocol. |

### 11.3 Anthropic Claude Code
| Feature | Details |
|---------|---------|
| **Primary Config** | `CLAUDE.md` in repo root. Hierarchical (root → parent → child directories → `~/.claude/CLAUDE.md`). |
| **Skills** | `SKILL.md` files in folders. **Lazy-loaded context injection**—only loaded when relevant. Uses NLU, not keywords. |
| **Memory** | 200K-1M token context window. "Blank slate" per session, but can retrieve past chats. |
| **CLI** | Agentic tool: edits files, runs tests, commits, responds to CI/CD. |

### 11.4 Cursor
| Feature | Details |
|---------|---------|
| **Primary Config** | `.cursor/rules/*.mdc` files (YAML frontmatter + Markdown). Legacy: `.cursorrules` in root. |
| **Global Rules** | `Settings → General` for language-agnostic personal preferences. |
| **Activation Modes** | `alwaysApply: true`, `globs` patterns, `@ruleName` manual include, or AI-decided. |
| **Prioritization** | `priority` field resolves conflicts. Higher number = higher precedence. |
| **Community** | `awesome-cursorrules` repo (35.9k stars), `cursor.directory` (65.9k members). |

### 11.5 Google Gemini CLI
| Feature | Details |
|---------|---------|
| **Primary Config** | `GEMINI.md` in repo root. |
| **Codebase Investigator** | Experimental **subagent** for in-depth repo analysis. Constructs feature understanding across multiple files, provides detailed reports. |
| **A2A** | Agent-to-Agent SDK enables orchestration of sub-agents. |
| **Memory** | Built-in memory tool for persistent knowledge. |

### 11.6 Comparative Matrix

| Capability | Codex CLI | Copilot | Claude Code | Cursor | Gemini CLI | **Us (MCP)** |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Static Instruction File | ✅ AGENTS.md | ✅ copilot-instructions.md | ✅ CLAUDE.md | ✅ .mdc | ✅ GEMINI.md | ⚠️ Complements |
| Hierarchical Config | ❌ | ⚠️ Org/Repo | ✅ Root→Child | ✅ Globs | ⚠️ | ❌ |
| **Dynamic Codebase Context** | ❌ | ⚠️ Spaces | ❌ | ❌ | ⚠️ Investigator | **✅ Core Value** |
| **Pattern Quantification** | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ Unique** |
| **Trend Detection** | ❌ | ❌ | ❌ | ❌ | ❌ | **✅ Unique** |
| Lazy-Loading Context | ❌ | ❌ | ✅ Skills | ✅ .mdc | ❌ | ❌ |
| Persistent Memory | ⚠️ (Profiles) | ✅ (Memory Preview) | ⚠️ (Per-Session) | ❌ | ✅ | ❌ |

---

## 12. Common AI Failure Patterns in Enterprise (December 2025)

These are the documented failure modes of AI coding assistants in enterprise environments, based on December 2025 industry reports.

| Failure Pattern | Description | Implication for MCP |
|---|---|---|
| **Lack of Business Context** | AI generates syntactically correct but functionally inappropriate code. Misses subtle business rules. | MCP provides **evidence of team conventions** (e.g., "Use PortalToastService, not raw toast") which encode business-specific patterns. |
| **Technical Debt Accumulation** | AI generates bloated, duplicated code (8x more duplication). Prioritizes boilerplate over lean solutions. | MCP's **Golden Files** provide canonical, optimized examples. |
| **Security Vulnerabilities** | AI-generated code has **1.7x more issues** and **2.74x more security vulnerabilities** (Dec 2025 report). | MCP's **trend detection** can flag "Declining" patterns that often correlate with deprecated/insecure APIs. (Future: `verify_compliance`). |
| **Architectural Drift** | AI loses track of patterns during long sessions due to context window limits. Generates inconsistent code. | MCP's **Pattern Frequency** is a constant reminder: "97% inject(), 3% constructor." |
| **Review Overload** | AI generates code faster than humans can review. 67% of devs report spending more time debugging AI code. | MCP's **`guidance` field** (v1.2) pre-computes the decision, reducing cognitive load on reviewers. |
| **Edge Case Blindness** | AI struggles with abstract concepts and unforeseen circumstances. | MCP cannot solve this directly. Requires human oversight. |

---

## 13. Key Artifacts Index

| Category | Artifact | Path |
|----------|----------|------|
| **Strategy** | The Pivot Narrative | [CONVERSATION_20251208.md](file:///c:/Users/bitaz/Repos/codebase-context/internal-docs/CONVERSATION_20251208.md) |
| **Roadmap** | Vision & Plan | [SPEC.md](file:///c:/Users/bitaz/Repos/codebase-context/internal-docs/SPEC.md) |
| **Execution** | Release Checklist | [TODO.md](file:///c:/Users/bitaz/Repos/codebase-context/internal-docs/TODO.md) |
| **Validation** | Market & Competitors | [02-competitive-validation.md](file:///c:/Users/bitaz/Repos/codebase-context/internal-docs/research/02-competitive-validation.md) |
| **Critique** | Red Team Review | [GEMINI-DEEP-RESEARCH-FEEDBACK.MD](file:///c:/Users/bitaz/Repos/codebase-context/internal-docs/GEMINI-DEEP-RESEARCH-FEEDBACK.MD) |
| **DORA** | Stability Paradox | [08-ai-dora-technology-radar-summary.md](file:///c:/Users/bitaz/Repos/codebase-context/internal-docs/research/08-ai-dora-technology-radar-summary.md) |
| **Academia** | Grounding & Context | [06-arxiv-research.md](file:///c:/Users/bitaz/Repos/codebase-context/internal-docs/research/06-arxiv-research.md) |

---
*End of Document*
