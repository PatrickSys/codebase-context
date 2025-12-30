# [DRAFT] AI Coding Agents now see "Rising" vs "Declining" patterns. Here's what changed.
TODO - Add tags for increased visibility of the post as it got very low visits last time. 
TODO: Add screenshot or images of structured, business-oriented validation results. What did the original article fail on, how to make this one more successful? 
TODO: Add image of architecture diagram well system-oriented with easy note on worfklows and units
Two weeks ago, I shared that AI coding assistants were copying legacy patterns from my codebase. Gemini scored 0/5 on pattern conformance—using constructor DI in a codebase where 97% use `inject()`.

**The problem?** Search contamination. When AI searches for examples, it finds legacy code mixed with modern code. It picks the first match.

## The Fix: Pattern Momentum in Search

We added "trend-aware search" to our MCP. Now each search result shows:
- `trend: "Rising"` or `trend: "Declining"`
- `patternWarning: "⚠️ Uses declining pattern: constructor DI"`

And we rank results accordingly:
- **Rising patterns**: +15% score boost
- **Declining patterns**: -10% score penalty

The AI still sees all results. We don't hide anything. But modern patterns float to the top.

## The New `guidance` Field

Instead of raw pattern stats ("97% inject"), we now provide actionable guidance:
- `"USE: inject() – 97% adoption, stable"`
- `"AVOID: constructor – 3%, declining (legacy)"`

The AI doesn't have to interpret percentages anymore. It gets direct instructions.

## Early Results

[TBD after validation testing]

Testing against the same codebase (SSP_Portal):
- Gemini baseline (v1.1, no MCP): 0/5 patterns
- Gemini with v1.2 MCP: X/5 patterns
- Legacy import contamination: [improved/same]

## The Limitation I'm Still Working On

Trend detection works at the **file level**, not line level. If a file was modified yesterday, we call it "Rising"—even if line 15 still has legacy code.

Why? Because tracking per-line changes requires `git blame` analysis, which is slow on large repos. That's v1.3.

## What This Means

We're moving from "Context Intelligence" (here's what the code looks like) to "Active Context" (here's what the code looks like, and here's a warning about what's old).

The AI still decides. We just give it better information at decision time.

---

**What patterns are your AI assistants copying that you wish they wouldn't?**

---

*This is part 2 of my series on AI Codebase Intelligence. [Part 1: The Problem](#)*
