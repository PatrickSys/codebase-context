# Why This Exists

> **TL;DR**: AI coding assistants increase throughput but often degrade stability. Without codebase context, they generate code that works but violates team conventions and architectural rules. This MCP provides structured pattern data and recorded rationale so agents produce code that fits.

The generated code compiles, passes basic tests, and completely ignores how your team does things or the business context. You fix it, correct the agent, and next session it starts from zero again. Even if you have curated instructions, you cannot note down every convention your team has and it is hard to maintain over time.

## The Problem

AI agents don't fail because they lack "best practices." They fail because they don't know _your_ practices.

| What happens                               | Why                                                               |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Agent uses a deprecated pattern            | Can't distinguish modern from legacy when exploring your codebase |
| Agent ignores your internal wrappers       | Doesn't know they exist — picks raw library imports               |
| Agent invents patterns that don't exist    | Makes up variable names, component names, CSS tokens              |
| Agent repeats a mistake you corrected      | No memory across sessions                                         |
| Agent edits confidently with weak evidence | No way to know when it doesn't know enough                        |

The root cause isn't the model. It's the context layer. Agents get raw code from search and generic rules from static files. No signal about what's current vs legacy, no team patterns, no memory.

## What Exists Today (and the missing context)

| Approach                     | What it does                                        | What's missing                                                                  |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `.cursorrules` / `AGENTS.md` | Static rules the agent may or may not always follow | Can't express migration states ("use A for new code, B for old"). Goes stale.   |
| Semantic search / RAG        | Finds similar code                                  | Blind to quality. Can't tell the best example to follow from hacky workarounds. |
| **Aider repo map**           | Compact structural map for the model                | No team pattern frequencies, memory, or edit preflight card.                   |
| **Repomix**                  | Pack repo (or slices) into a prompt                 | One-shot context, not live search, conventions, or session memory.             |
| **jCodeMunch**               | Fast MCP code search                                | Strong retrieval in our fixed benchmark; less convention/memory/edit gating.  |
| Linters / formatters         | Enforce static rules after writing                  | Don't guide before or during generation. Agent still writes wrong code first.   |
| Tool-heavy MCPs (50+ tools)  | Expose everything                                   | Agents don't know which tool to call. More tools = more confusion.              |

## What This MCP Does Differently

### Active context, not passive instructions

When the agent searches, it doesn't get raw code. It gets code with codebase intelligence attached:

- Is this file using a new or legacy pattern?
- What other files import it?
- What team decisions relate to this area?
- Is the context evidence strong enough to edit?
- What conventions should the Agent prefer and what to avoid?

### Conventions from code, not from documentation

Pattern detection runs on the actual codebase, not only on rules someone wrote. If 97% of the team uses the (Angular) `inject()` function for DI over constructor DI and it's trending up, the agent knows - even if nobody documented it.

### Memory that compounds

Correct the agent once. Record the decision. From then on, it surfaces in search results and the "preflight" cards - that safeguard AI Agents from generating code that "just compiles". Memories age with confidence decay so stale guidance gets flagged instead of blindly trusted.

### Evidence gating

Before an edit, the response includes a decision card. `ready: true` means there's enough evidence from the codebase, patterns, and team memory to proceed. `ready: false` comes with `whatWouldHelp` — specific searches to run, specific files to check, or calls to `get_team_patterns` that would close the gap. The card also surfaces caller coverage: if you're editing a function that five files import but only two of them appear in your results, you know which ones you haven't looked at yet (`coverage: "2/5 callers in results"`). This is the difference between "confident assumption" and "informed decision."

### Guardrails via frozen eval + regressions

When retrieval quality silently degrades (Unicode slicing bugs, large generated files, parser failures), agents still produce confident output — just with worse evidence. Shipping frozen eval fixtures plus regression tests makes these failures measurable and blocks "fix the tests" style metric gaming.

## Key Design Decisions

1. **Fewer tools, richer responses.** 10 tools instead of 50. One search call that aggregates everything.
2. **Local-first.** Embeddings default to a local model (Transformers.js). No cloud, no API key required - but absolutely optional.
3. **Evidence over opinions.** Every signal has a source: adoption %, trend direction, confidence score. No "best practice" claims.
4. **Graceful degradation.** If intelligence isn't available, search still works — just without enrichment. Preflight is additive, not required.

## Sources

- [Stack Overflow 2024 Developer Survey](https://survey.stackoverflow.co/2024/ai) — 64.7% cite lack of codebase context as top AI challenge
- [GitClear 2024](https://www.gitclear.com/) — Code churn correlation with AI adoption
- [DORA State of DevOps 2024](https://dora.dev/research/2024/dora-report/) — Throughput vs stability tradeoff
