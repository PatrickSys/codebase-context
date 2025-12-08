Fact-Check: MCP Implementation Plan vs Evidence
Date: 2025-12-08
Purpose: Critical, objective analysis of current MCP documentation against test evidence Method: Cross-reference 
BLIND_SPOTS.md
 recommendations against 
TEST_RESULTS.md
, 
SPEC.md
, and research files

Executive Summary: Diagnosis is Sound, But Plan Has Gaps
The 
BLIND_SPOTS.md
 diagnosis is well-supported by evidence. However, there are critical inconsistencies between the diagnosis and the documented roadmap in 
SPEC.md
 and 
TODO.md
.

Key Finding
The documentation accurately identifies the problem but the proposed solutions are misaligned with the evidence.

Fact-Check: Diagnosis Accuracy ✅
Claim 1: "MCP excels at structural intelligence but lacks visual/design intelligence"
Evidence from TEST_RESULTS.md:

Model	MCP Status	Services	Architecture	UI Components	Design Tokens
GPT 5.1-High	-MCP	❌ Hallucinated	❌ Missing routing	✅ CodeBlue	✅ var(--cb-*)
GPT 5.1-High	+MCP	✅ Correct	✅ Full integration	❌ Native HTML	❌ Hardcoded
Verdict: ✅ CONFIRMED. The paradox is real.

Claim 2: "AGENTS.md/GEMINI.md static files achieve 75% pattern conformance"
Evidence from TEST_RESULTS.md (Gemini 3 Pro Preview):

Without any guidance: 0/5 patterns (constructor DI, no signals, no libs)
With GEMINI.md only: 5-6/8 patterns (inject ✅, Jest ✅, CodeBlue ✅)
With MCP + GEMINI.md: 6/8 patterns (added signals, i18n, but wrapper regression)
Verdict: ✅ CONFIRMED. Static instructions are highly effective.

Quote from TEST_RESULTS.md:

"If MCP only improves from 5-6/8 to 6-7/8, the ROI is questionable for code generation use cases."

Claim 3: "Gap for MCP is 1-2 points improvement at best"
Evidence from TEST_RESULTS.md:

Configuration	Score
GEMINI.md only	5-6/8
MCP + GEMINI.md	6/8
Delta	+0 to +1
And MCP caused a regression in one area (primeng direct imports vs @codeblue wrappers).

Verdict: ✅ CONFIRMED. MCP's marginal value is minimal when competing with good static instructions.

Fact-Check: Inconsistencies Found ❌
Inconsistency 1: SPEC.md Claims Don't Reflect Test Evidence
SPEC.md lines 74-78 claim:

| Internal Library Discovery | UNIQUE | Enables Agents to use @mycompany/utils instead of reinventing wheels. | | Wrapper Detection & Warnings | UNIQUE | Prevents Agents from importing primeng when @mycompany/ui-toolkit is required. |

But TEST_RESULTS.md shows:

GPT 5.1-High +MCP: "Used native HTML <select> elements instead of CodeBlue/PrimeNG components"
Gemini +MCP +GEMINI.md: "Direct PrimeNG imports (primeng/button, primeng/inputtext) instead of @codeblue/prime/* wrappers"
Verdict: ❌ INCORRECT. Wrapper detection exists but does NOT prevent wrong imports. The claim is aspirational, not validated.

Inconsistency 2: TODO.md Focuses on Launch, Not Core Problem
BLIND_SPOTS.md Critical Recommendations:

Add UI Component Inventory Tool
Enhance Golden Files with UI Patterns
Add Negative Guidance to Wrapper Recommendations
TODO.md Focus:

Phase A: Deploy & Verify (npm publish)
Phase B: Validate with Evidence (more tests)
Phase C: Launch Assets (LinkedIn post, screenshots)
Gap: TODO.md doesn't include ANY of the critical fixes from BLIND_SPOTS.md.

Verdict: ❌ MISALIGNED. The "launch checklist" will ship a product with known, documented limitations that contradict marketing claims.

Inconsistency 3: SPEC.md Roadmap Doesn't Address UI Gap
SPEC.md Phase 1.7 (Pre-Launch) includes:

check_import tool (validates imports exist)
refresh_recent_files tool (quick updates)
Performance tier documentation
SPEC.md does NOT include (despite BLIND_SPOTS.md marking as Critical):

UI Component Inventory Tool
Enhanced Golden Files with templates
Negative guidance/anti-patterns
Phase 2 and Phase 3 also don't address design system intelligence.

Verdict: ❌ STRATEGIC OMISSION. The roadmap ignores the primary gap revealed by testing.

Inconsistency 4: Competitive Claims Are Unfounded
02-competitive-validation.md lines 315-320:

| Pattern frequency ("97% inject") | ✅ | ❌ | ❌ | ❌ | ❌ | | Wrapper detection | ✅ | ❌ | ❌ | ❌ | ❌ | | Golden Files | ✅ | ❌ | ❌ | ❌ | ❌ |

Reality from testing:

Pattern frequency works ✅
Wrapper detection exists but doesn't prevent issues ⚠️
Golden Files don't include UI patterns (BLIND_SPOTS.md #4) ⚠️
Verdict: ⚠️ OVERSOLD. Features "work" technically but don't deliver claimed outcomes.

Inconsistency 5: Market Research Gap in SPEC.md
01-market-research.md key insight:

"The fragmentation actually strengthens the case for codebase-context MCP: Format-agnostic. We don't just 'instruct' the Agent; we empower it with tools to look around."

But TEST_RESULTS.md shows:

"Gemini CLI used a 'Codebase Investigator Agent' subagent that: Explored directory structure, Found the user-settings directory, Analyzed routing structure"

Gap: Gemini already has built-in codebase exploration. MCP's "look around" value proposition is not unique when models have native codebase tools.

This is not reflected in SPEC.md's competitive positioning.

Verdict: ❌ OUTDATED ASSUMPTION. The competitive landscape has shifted with embedded model capabilities.

Recommended Documentation Updates
1. Update SPEC.md "What We Provide" (Honest Version)
Current (Lines 72-78):

| Capability | Value | Rationale |
|------------|-------|-----------|
| **Internal Library Discovery** | **UNIQUE** | Enables Agents to use @mycompany/utils |
| **Wrapper Detection & Warnings** | **UNIQUE** | Prevents Agents from importing primeng |
Proposed:

| Capability | Value | Status | Evidence |
|------------|-------|--------|----------|
| **Internal Library Discovery** | UNIQUE | ✅ Working | Agents find libs |
| **Wrapper Detection** | Data Available | ⚠️ Partial | Data surfaced, but not enforced |
| **Wrapper Enforcement** | Needed | ❌ Missing | Models ignore warnings |
| **UI Component Guidance** | Needed | ❌ Missing | Models use native HTML |
| **Design Token Patterns** | Needed | ❌ Missing | Models use hardcoded CSS |
2. Update TODO.md to Include Critical Fixes
Add new section before Phase A:

## Phase 0.5: Address Critical Blind Spots
Based on SSP_Portal_0712 testing (December 2025):
| Fix | Why Critical | Effort |
|-----|--------------|--------|
| Negative guidance in wrapper recommendations | Models ignore "exists" warnings | Low (1 day) |
| Golden Files include template snippets | Primary guidance mechanism lacks UI | Low (1 day) |
| Document limitations honestly | Prevents overpromising | Low (half day) |
**Decision needed**: Fix pre-launch or document as known limitation?
3. Add Limitations Section to SPEC.md
Insert before "Sources" section:

## Known Limitations (Validated December 2025)
Based on testing with GPT 5.1-High, Gemini 3 Pro Preview, and other models:
| Area | Status | Evidence |
|------|--------|----------|
| **Structural patterns** (DI, architecture) | ✅ Effective | +MCP prevents service hallucination |
| **UI component selection** | ❌ Not Effective | +MCP models used native HTML |
| **Design token enforcement** | ❌ Not Effective | +MCP models used hardcoded CSS |
| **Wrapper prevention** | ⚠️ Partial | Data surfaced but models ignore |
**Recommendation**: Pair MCP with static instruction files (AGENTS.md, GEMINI.md) for complete guidance.
4. Update 02-competitive-validation.md Positioning
Current (Line 346):

"They help AI find code. We help AI understand how YOUR team builds code."

Reality: This is aspirational. Testing shows MCP helps with some patterns (DI, testing) but not all patterns (UI, design).

Proposed revision:

"They help AI find code. We help AI understand architectural patterns. For UI/design patterns, MCP complements static instruction files."

5. Create A Consolidated "State of MCP" Document
Problem: Critical insights are scattered across:

BLIND_SPOTS.md
 (diagnosis)
TEST_RESULTS.md
 (evidence)
SPEC.md
 (claims)
TODO.md
 (next steps)
These documents contradict each other and create confusion.

Recommendation: Create internal-docs/STATE_OF_MCP.md that synthesizes:

What works (with evidence citations)
What doesn't work (with evidence citations)
Strategic options (fix vs document vs pivot)
Priority-ordered next steps
Strategic Options
Based on the evidence, three paths forward:

Option A: Fix Before Launch (2-3 weeks)
Implement BLIND_SPOTS.md Critical items:

UI Component Inventory Tool
Enhanced Golden Files
Negative guidance
Pro: Delivers on value proposition
Con: Delays launch, significant effort

Option B: Launch with Documented Limitations (Now)
Ship current state, add honest limitations section to README/SPEC.

Pro: Fast to market, honest
Con: Undermines competitive positioning

Option C: Pivot Positioning (1 week)
Reframe MCP as "Architectural Intelligence" layer that complements static files.

Pro: Honest, defensible, still unique
Con: Reduces scope of value proposition

Conclusion
The 
BLIND_SPOTS.md
 diagnosis is accurate and well-supported by test evidence. However:

SPEC.md claims exceed proven capabilities in UI/design areas
TODO.md ignores critical fixes from BLIND_SPOTS.md
Competitive positioning is optimistic, not battle-tested
Static instruction files are more effective than previously assumed
Recommendation: Before any code changes, consolidate these findings into a single decision document and update all .md files to reflect the proven capabilities, not the hoped-for ones.

The goal is documentation clarity, not code. Ship honest docs first.