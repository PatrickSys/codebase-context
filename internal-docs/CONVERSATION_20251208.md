# Comprehensive Context Transfer: Codebase-Context-MCP (Dec 8, 2025)

**PURPOSE**: This document captures the complete state, strategy, test results, and critical learnings to bootstrap a new agent session. It resolves the cognitive dissonance between "What we planned" (Governance) and "What we have" (Discovery).

---

## 1. The Core Identity Crisis (Resolved)

We started with a vision of **"Automated Governance"** (Phase 2).
We ended with a reality of **"Codebase Discovery"** (Phase 1).

**The Pivot Logic**:
- **Why Governance Failed (MVP)**: We lack the "Enforcement" logic (`detect_anti_patterns`) and we can't infer intent from statistics (The 3% Problem).
- **Why Discovery Wins**: It's unique (competitors don't have pattern stats), it's built, and it solves a real problem (finding internal libraries/patterns that static files can't list exhaustively).

**Strategic Stance**: 
> "MCP is the Map. AGENTS.md is the Law. They are complementary."

---

## 2. The "3% Problem" (Crucial Insight)

**The Logic Trap**: Pure statistical observation identifies "majority" as "correct."
- **Scenario**: Team is migrating from RxJS (70% usage) to Signals (30% usage).
- **MCP Output**: "Use RxJS (Dominant). Avoid Signals (Minority)." ❌
- **Truth**: "Use Signals (Target). RxJS is Legacy."

**Conclusion**: We cannot prescriptive `quickGuidance` based purely on stats. We need **Intent** (AGENTS.md) to override **Observation** (MCP).

---

## 3. Test Session Results: SSP_Portal_1208

**Methodology**: GPT 5.1-High (Codex CLI), Task: "Create user settings component."

| Metric | Run 1 (-MCP) | Run 2 (-MCP) | Run 3 (+MCP) |
|--------|--------------|--------------|--------------|
| **Environment** | WSL | WSL | Windows (Native) |
| **Tool Usage** | 0 calls | 0 calls | **5 calls** (Success) |
| **Location** | `libs/admin` | `libs/admin` | **`libs/ui`** (Architectural Win) |
| **Pattern** | Reactive Forms | Reactive Forms + Signals | **`input()` + `effect()`** (Modern) |
| **Tests** | 4 | 5 | 5 (inc. input binding) |
| **LOC** | 187 | 223 | 198 |

**Key Learnings**:
1. **Variance is High**: -MCP runs differed wildly (Signals vs No Signals) with identical config.
2. **Environment Matters**: Models in WSL (via Codex CLI) often fail to call MCP tools. Windows Native worked.
3. **Value is Discovery**: +MCP didn't "fix" patterns (AGENTS.md did that). It found *new* patterns (`input()`) and *better locations* (`libs/ui`).

---

## 4. Research Synthesis (DORA & Tech Radar)

**Source**: `internal-docs/research/08-ai-dora-technology-radar-summary.md`

1. **The Stability Paradox**: AI increases Throughput (Speed) but decreases Stability (Quality).
2. **The "Trust Gap"**: 30% of devs don't trust AI code.
3. **The Solution**: Platform Engineering ("Golden Paths") + Actionable Context.
4. **The Gap**: Developers want **decisions**, not **data**.

**Our Alignment**:
- We provide **Data** (Search, Frequencies).
- We aspire to provide **Decisions** (`quickGuidance`), but are blocked by the 3% Problem.

---

## 5. Current State of the Codebase

**Implemented Features**:
- `search_codebase` (Semantic + Keyword)
- `get_team_patterns` (Frequency counts: "97% inject")
- `get_component_usage` (Internal lib discovery: "847 uses")
- `get_codebase_metadata` (Framework detection)
- `get_style_guide` (Golden Files)

**Missing / Roadmap**:
- `quickGuidance` / `antiPatterns` fields (Not working due to 3% problem logic)
- `detect_anti_patterns` tool (The "Sheriff" - Phase 2)
- Incremental Indexing (Planned Phase 2)

---

## 6. The "Honest" Pitch (Revised)

**Narrative**: 
"AI agents already have search. But they lack **pattern intelligence**. 
- They don't know you use `@company/ui` (847 uses) instead of `primeng` (3 uses).
- They don't know you use `inject()` (97%) not `constructor` (3%).
- They don't know where your 'Golden Files' are.

I built the **Discovery Layer** that gives AI the eyes to see YOUR codebase reality. It complements your `AGENTS.md` (which defines the rules) by providing the map."

---

## 7. Next Steps & Action Plan

**Immediate**:
1. **Accept the Pivot**: Position as "Discovery Layer" for now.
2. **Refine Testing**: Run 3+ consecutive runs with same +MCP config to prove variance reduction.
3. **LinkedIn Post**: Publish the "Map vs Law" narrative (Honest alignment).

**Mid-Term**:
4. **Solve 3% Problem**: Implement logic to read `AGENTS.md` intent and merge with MCP stats for `quickGuidance`.

---

## 8. Artifacts Reference

- **Pivot Strategy**: `internal-docs/pivot-strategy.md` (The Governance Ambition)
- **Research**: `internal-docs/research/` (Dora, Competitive Analysis)
- **Test Results**: `internal-docs/tests/SSP_Portal_1208/` (Log files)
- **Spec**: `internal-docs/SPEC.md` (The Product Vision)
