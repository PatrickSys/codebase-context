# Motivation: Why This Exists

> **TL;DR**: AI coding assistants increase throughput but often degrade stability. Without codebase context, they generate code that works but violates team conventions and architectural rules. This MCP provides structured pattern data and recorded rationale so agents produce code that fits.

---

## The Problem

### The "Stability Paradox"
AI drastically increases **Throughput** (more code/hour) but often kills **Stability** (more bugs/rework).

| Pain Point | Evidence |
|------------|----------|
| **"AI doesn't know my codebase"** | 64.7% of developers cite lack of codebase context as top AI challenge ([Stack Overflow 2024](https://survey.stackoverflow.co/2024/ai)) |
| **"Vibe coding" = Tech Debt** | Code churn doubled, rework increased. AI writes "working" code that breaks architectural rules ([GitClear 2024](https://www.gitclear.com/)) |
| **The "Mirror Problem"** | Semantic search just finds *similar* code. If 80% of your code is legacy/deprecated, AI will copy it. The tool becomes a mirror reflecting your bad habits. |
| **Trust gap** | Only 29% of developers trust AI output. Teams spend more time reviewing AI code than writing it. |

### What Existing Tools Don't Solve

| Tool Category | What They Do | The Gap |
|---------------|--------------|---------|
| **AGENTS.md / .cursorrules** | Static instructions (Intent) | Can't handle migration states (e.g., "Use A for new, B for old"). Static = brittle. |
| **Semantic Search (RAG)** | Finds *relevant* text | Blind to *quality*. Can't distinguish "High Churn Hotspot" from "Stable Core". |
| **Linters** | Complain *after* coding | Don't guide *during* generation. |

---

## What This Does

This MCP provides **active context** - not raw data, but structured intelligence derived from actual codebase state.

### 1. Pattern Discovery (The "Map")
- **Frequency Detection**: "97% use `inject()`, 3% use `constructor`." (Consensus)
- **Internal Library Support**: "Use `@company/button`, not `p-button`." (Wrapper Detection)
- **Golden Files**: "Here is the *best* example of a Service, not just *any* example."

### 2. Temporal Wisdom (The "Compass")
- **Pattern Momentum**: "Use `Signals` (Rising), avoid `BehaviorSubject` (Declining)."
- **Health Context**: "⚠️ Careful, `UserService.ts` is a high-churn hotspot with circular dependencies. Add tests."

### Works with AGENTS.md
- **AGENTS.md** defines intent: "Use functional patterns."
- **MCP** provides evidence: "Here are the 5 most recent functional patterns actually used."

---

## Known Limitations

| Limitation | Mitigation |
|------------|--------|
| **Pattern frequency ≠ pattern quality** | **Pattern Momentum** (Rise/Fall trends) distinguishes adoption direction from raw count. |
| **Stale index risk** | Manual re-indexing required for now. |
| **Framework coverage** | Deep analysis for Angular. Generic analyzer covers 30+ languages. React/Vue specialized analyzers extensible. |
| **File-level trend detection** | Trend is based on file modification date, not line-by-line content. A recently modified file may still contain legacy patterns on specific lines. Future: AST-based line-level detection. |

---

## Key Learnings (The Journey)

1.  **Context alone is dangerous**: Giving AI "all the context" just confuses it or teaches it bad habits (Search Contamination).
2.  **Decisions > Data**: AI needs *guidance* ("Use X"), not just *options* ("Here is X and Y").
3.  **Governance through Discovery**: Blocking PRs is not required. If the AI sees that a pattern is "Declining" and "Dangerous," it self-corrects.

---

## Sources

### Industry Research
1. [Stack Overflow 2024 Developer Survey](https://survey.stackoverflow.co/2024/ai)
2. [GitClear 2024 AI Code Quality Report](https://www.gitclear.com/) (The "Churn" problem)
3. [DORA State of DevOps 2024](https://dora.dev/research/2024/dora-report/) (Stability vs Throughput)

### Internal Validation
- **Search Contamination**: Without MCP, models copied legacy patterns 40% of the time.
- **Momentum Success**: With "Trending" signals, models adopted modern patterns even when they were the minority (3%).

