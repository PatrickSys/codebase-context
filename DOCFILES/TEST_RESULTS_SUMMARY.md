# MCP Test Results Summary

Aggregated findings across test sessions.

---

## Test Matrix

| Session | Feature | Model | Environment | MCP | Build | Patterns | Tokens | Time | Notes | Failure |
|---------|---------|-------|-------------|-----|-------|----------|--------|------|-------|---------|
| SSP_Portal_0712 | User Settings | Grok Code | Cursor | ✅ | ❌ | 2/5 | 44.6K | - | - | Hallucination |
| SSP_Portal_0712 | User Settings | Grok Code | Cursor | ❌ | ✅ | 4/5 | 48.2K | - | - | Ignored |
| SSP_Portal_0712 | User Settings | GPT-5 Mini | Cursor | ❌ | ⚠️ | 4/5 | 26.8K | - | - | Type error |
| SSP_Portal_0712 | User Settings | GPT-5 Mini | Cursor | ✅ | ✅ | 5/5 | 30.9K | - | - | None |
| SSP_Portal_0712 | User Settings | Codex Mini High | Codex CLI | ❌ | ⚠️ | 5/5 | ~33K | 12m+ | No MCP calls, self-corrected 5x | Build issue |
| SSP_Portal_0712 | User Settings | Codex Mini High | Codex CLI | ✅ | TBD | 4/5 | TBD | TBD | Used MCP, mixed legacy patterns | Legacy CSS |
| SSP_Portal_0712 | User Settings | GPT 5.1-High | Codex CLI | ❌ | ❌ | 3/5 | TBD | 7-8m | ~350 | 3 build errors, stopped prematurely | Type errors |
| SSP_Portal_0712 | User Settings | GPT 5.1-High | Codex CLI | ✅ | ✅ | 5/5 | TBD | TBD | ~330 | Strong architecture, weak UI components | None |
| SSP_Portal_0712 | User Settings | Gemini 3 Pro Preview | Gemini CLI | ❌ | ⚠️ | 0/5 | TBD | ~4m | ~263 | Constructor DI, no signals, no libs, no tokens | Anti-patterns |
| SSP_Portal_0712 | User Settings | Gemini 3 Pro Preview | Gemini CLI | ✅ +GEMINI.md | ✅ | 5-6/8 | TBD | ~4m | ~200 | Built-in codebase subagent, static instructions | Minor invention |
| SSP_Portal_0712 | User Settings | Gemini 3 Pro Preview | Gemini CLI | ✅ +MCP +GEMINI.md | TBD | 6/8 | TBD | ~4m | ~200 | Added signals, i18n; missed wrappers | Wrapper confusion |
| SSP_Portal_0712 | User Settings | Claude Sonnet 4.5 | Copilot Chat | ✅ | TBD | TBD | TBD | TBD | TBD | TBD |

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
