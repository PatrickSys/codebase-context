# MCP Test Results Summary

Aggregated findings across test sessions. All tests use SSP_Portal as the target codebase.

---

## Summary Table

| Session | Model | MCP | Pattern Score | LOC | Build | Time | Notes |
|---------|-------|-----|---------------|-----|-------|------|-------|
| 1207 | Grok Code | ✅ | 2/5 | ~1600 | ❌ | - | Hallucinated modules |
| 1207 | Grok Code | ❌ | 4/5 | ~700 | ✅ | - | Better without MCP |
| 1207 | GPT-5 Mini | ❌ | 4/5 | ~250 | ⚠️ | - | Type error |
| 1207 | GPT-5 Mini | ✅ | 5/5 | ~113 | ✅ | - | Clean |
| 1207 | GPT 5.1-High | ❌ | 3/5 | ~350 | ❌ | 7-8m | Stopped early |
| 1207 | GPT 5.1-High | ✅ | 5/5 | ~330 | ✅ | - | Good architecture |
| 1207 | Gemini 3 Pro | ❌ | 0/5 | ~263 | ⚠️ | ~4m | All anti-patterns |
| 1207 | Gemini 3 Pro | ✅ +GEMINI.md | 5-6/8 | ~200 | ✅ | ~4m | Static docs worked |
| 1208 | GPT 5.1-High | ❌ (Run 1) | 6/7* | 187 | ✅ | 8m | No MCP called |
| 1208 | GPT 5.1-High | ❌ (Run 2) | 7/7* | 223 | ✅ | ~6m | Variance check |
| 1208 | GPT 5.1-High | ✅ (Run 3) | 8/9* | 198 | ✅ | 7m | Added input() pattern |
| 1230 | Grok (fast) | ✅ | 5.3±0.5** | 204±9** | ✅ | ~4m | 3-run variance |

\* 1207/1208 used different scoring rubric (5 vs 7 vs 9 patterns)  
\*\* First test using 3-run protocol with mean ± SD

---

## Key Findings

### 1. MCP Impact by Model

| Model | MCP Effect | Summary |
|-------|------------|---------|
| **Grok Code** | Negative | Hallucinated despite data (1207) |
| **GPT-5 Mini** | Positive | +15% tokens, better patterns |
| **GPT 5.1-High** | **Paradox** | 1208: AGENTS.md alone achieved 7/7. MCP added `input()` pattern but no quality gain |
| **Gemini 3 Pro** | **AGENTS.md >> MCP** | Static instructions (GEMINI.md) achieved 75% conformance alone |

### 2. Critical Insights

**From 1208 Session**:
> **"No MCP tools were called"** despite MCP being enabled. All correct patterns came from AGENTS.md alone.

**Implication**: Static documentation (AGENTS.md) is sufficient for pattern enforcement. MCP's value is in **discovery** (finding examples), not **enforcement** (following rules).

### 3. Temperature Variance

**1208 baseline variance** (-MCP, same config):
- Run 1: 187 LOC, 6/7 patterns
- Run 2: 223 LOC, 7/7 patterns
- **Delta**: 36 LOC ± 1 pattern

**1230 variance protocol** (+MCP, 3 runs):
- Mean: 204 ± 9 LOC, 5.3 ± 0.5 patterns
- **Interpretation**: SD < 0.5 = Low variance, stable

---

## Failure Modes Documented

| Issue | Sessions | Description |
|-------|----------|-------------|
| **Search Contamination** | 1207 | MCP returned legacy code, model copied it |
| **Tool Ignoring** | 1207, 1208 | Model saw data (847:3 ratio) but used wrong pattern |
| **Hallucination** | 1207 | Invented `@codeblue/angular-card` despite MCP data |
| **No Tool Calls** | 1208 | MCP enabled but never invoked |

---

## Methodology Evolution

| Version | Sessions | Changes |
|---------|----------|---------|
| **v1.0** | 1207 | Single-run, manual scoring |
| **v1.1** | 1208 | Multi-run comparison, comparative analysis |
| **v2.0** | 1230+ | 3-run variance, automated scoring, standardized templates |

---

## Next Steps

- [ ] Complete 1230 -MCP baseline (3 runs)
- [ ] Test Claude Haiku 4.5 (new model)
- [ ] Backfill 1207/1208 with automated scoring
- [ ] Standardize all sessions to new template format

---

*Last updated: December 30, 2025*
|
| SSP_Portal_1207 | User Settings | Grok Code | Cursor | ✅ | ❌ | 2/5 | 44.6K | - | - | Hallucination |
| SSP_Portal_1207 | User Settings | Grok Code | Cursor | ❌ | ✅ | 4/5 | 48.2K | - | - | Ignored |
| SSP_Portal_1207 | User Settings | GPT-5 Mini | Cursor | ❌ | ⚠️ | 4/5 | 26.8K | - | - | Type error |
| SSP_Portal_1207 | User Settings | GPT-5 Mini | Cursor | ✅ | ✅ | 5/5 | 30.9K | - | - | None |
| SSP_Portal_1207 | User Settings | Codex Mini High | Codex CLI | ❌ | ⚠️ | 5/5 | ~33K | 12m+ | No MCP calls, self-corrected 5x | Build issue |
| SSP_Portal_1207 | User Settings | Codex Mini High | Codex CLI | ✅ | TBD | 4/5 | TBD | TBD | Used MCP, mixed legacy patterns | Legacy CSS |
| SSP_Portal_1207 | User Settings | GPT 5.1-High | Codex CLI | ❌ | ❌ | 3/5 | TBD | 7-8m | ~350 | 3 build errors, stopped prematurely | Type errors |
| SSP_Portal_1207 | User Settings | GPT 5.1-High | Codex CLI | ✅ | ✅ | 5/5 | TBD | TBD | ~330 | Strong architecture, weak UI components | None |
| SSP_Portal_1207 | User Settings | Gemini 3 Pro Preview | Gemini CLI | ❌ | ⚠️ | 0/5 | TBD | ~4m | ~263 | Constructor DI, no signals, no libs, no tokens | Anti-patterns |
| SSP_Portal_1207 | User Settings | Gemini 3 Pro Preview | Gemini CLI | ✅ +GEMINI.md | ✅ | 5-6/8 | TBD | ~4m | ~200 | Built-in codebase subagent, static instructions | Minor invention |
| SSP_Portal_1207 | User Settings | Gemini 3 Pro Preview | Gemini CLI | ✅ +MCP +GEMINI.md | TBD | 6/8 | TBD | ~4m | ~200 | Added signals, i18n; missed wrappers | Wrapper confusion |
| SSP_Portal_1207 | User Settings | Claude Sonnet 4.5 | Copilot Chat | ✅ | TBD | TBD | TBD | TBD | TBD | TBD |

---

## MCP Impact by Model

| Model | MCP Effect | Notes |
|-------|------------|-------|
| Grok Code | Negative | Invented modules despite data |
| GPT-5 Mini | Positive | +15% tokens, better patterns |
| Codex Mini High | Neutral | -MCP: 5/5 patterns, no MCP calls. +MCP: 4/5, used tools but surfaced legacy patterns |
| **GPT 5.1-High** | **Paradox** | **-MCP: 3/5, CodeBlue components ✅, hallucinated services ❌. +MCP: 5/5, services ✅, native HTML ❌** |
| **Gemini 3 Pro Preview** | **Highly Negative** | **0/5 patterns. Constructor DI in 97% inject() codebase. No signals, no internal libs, no design tokens. Fastest execution (4m) but worst quality. Zero codebase awareness.** |
| **Gemini 3 Pro Preview +GEMINI.md** | **GEMINI.md Highly Effective (5-6/8)** | **Static instructions achieved 75% conformance. inject()✅, Jest✅, CodeBlue✅, PortalToastService✅. Built-in "Codebase Investigator" subagent. MCP gap: 1-2 points max.** |
| **Gemini 3 Pro Preview +MCP +GEMINI.md** | **Mixed - Added Value, Wrapper Confusion (6/8)** | **MCP added signals✅ (41% adoption data), i18n✅ (translation patterns). Failed: wrapper enforcement (primeng direct vs @codeblue). Net: +1 pattern (i18n) but wrapper regression. Market reality: AGENTS.md adoption growing in AI-forward teams.** |
| Gemini 3 Pro | TBD | |
| Claude Sonnet 4.5 | TBD | |

---

## Failure Counts

| Category | Count | Models |
|----------|-------|--------|
| Hallucination | 1 | Grok |
| Ignored | 1 | Grok |
| Type error | 1 | GPT-5 Mini |
| None | 1 | GPT-5 Mini +MCP |

---

*Last updated: December 2025*
