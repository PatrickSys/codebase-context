# MCP Testing Framework

Objective validation of MCP effectiveness across models.

---

## Models

### Required

| Model | Environment | Tier | Status |
|-------|-------------|------|--------|
| **GPT 5.1-High** | Codex CLI | Flagship | Pending |
| **Gemini 3 Pro** | Gemini CLI | Flagship | Pending |
| **Claude Sonnet 4.5** | GitHub Copilot Chat (VS Code) | Flagship | Pending |

### Optional

| Model | Environment | Tier | Status |
|-------|-------------|------|--------|
| Codex 5.1 Max | Codex CLI | Flagship (autonomous) | Optional - agentic workflow test |
| Grok Code | Cursor | Mid | Done (reference) |
| GPT-5 Mini | Cursor | Mid | Done (reference) |

> **Note**: Required models are flagships from each major ecosystem (OpenAI, Google, Anthropic). This ensures we test MCP on the best available models with the best available access.

---

## Universal Prompt

**All models use the same prompt** to ensure controlled comparison:

```
Do the following:
- Create a new Angular component for managing user settings.
- DO create unit tests for the component and code created. Make sure it is covered for at least the basic cases.
- Do NOT run ng build, ng test, or any validation commands.
- Do NOT yield your turn until fully implemented.
- DO NOT STOP UNTIL YOU ARE SURE THE TASK IS ENTIRELY DONE AND YOU HAVE COMPLETED ALL THESE PREVIOUS ITEMS IN THIS LIST
```

For `+MCP` tests, the MCP server is enabled. Models may or may not use it—that's what we're measuring.

---

## Metrics

### Primary

| Metric | Pass Criteria |
|--------|---------------|
| **Build** | `ng build` exits 0 |
| **Pattern Score** | ≥6/8 patterns match MCP data |
| **Integration** | ≥2/3 integration checks pass |

### Pattern Checklist (8 items)

**Framework Patterns (5 items)**:

| # | Pattern | Check |
|---|---------|-------|
| 1 | DI method | Uses `inject()` |
| 2 | Signals | Uses `signal()`/`computed()` |
| 3 | Component style | Standalone |
| 4 | Test framework | Jest (not Jasmine) |
| 5 | Internal libs | Uses @company/* over external |

**Design System Patterns (3 items)** - *Added 2025-12-08*:

| # | Pattern | Check |
|---|---------|-------|
| 6 | UI components | Uses design system components (not native HTML) |
| 7 | Design tokens | Uses CSS variables (not hardcoded values) |
| 8 | Component wrappers | Uses @codeblue/* (not primeng/* directly) |

> **Note**: Design system patterns added after GPT-5.1-High paradox revealed MCP doesn't guide UI component selection. See `BLIND_SPOTS.md` for details.

### Build Quality

| Metric | Record | Example |
|--------|--------|--------|
| Build status | ✅ Pass / ⚠️ Warnings / ❌ Errors | ❌ |
| Type errors | Count | 3 |
| Import errors | Count (hallucinations) | 1 |
| Error codes | List TypeScript error codes | TS2322, TS2571 |

### Integration Completeness

| Metric | Check | Pass Criteria |
|--------|-------|---------------|
| Routing | Component routed | Added to routing module |
| Navigation | Accessible via menu | Added to navigation menu |
| Translations | i18n keys added | Translation keys defined |
| **Score** | **0-3 points** | **≥2 required** |

### Efficiency

| Metric | Record |
|--------|--------|
| Token count | From IDE/CLI |
| Time | Duration in minutes |
| LOC | Total lines |
| Notes | Observations (self-corrections, MCP usage, anomalies) |

---

## Failure Categories

| Category | Description | Example |
|----------|-------------|--------|
| **Hallucination** | Invented imports/APIs | `PortalToastService` from wrong package |
| **Ignored** | MCP data available but not used | MCP shows CodeBlue, uses native HTML |
| **Incomplete** | Missing expected features | No routing/navigation setup |
| **Type error** | TypeScript failures | TS2322, TS2571 |
| **Design drift** | Violates design system | Hardcoded CSS, native `<select>` |
| **Anti-pattern** | Incorrect pattern usage | Useless `effect()`, mixed paradigms |

---

## Protocol

### Three-Tier Testing Matrix

Test each model in **four configurations** to understand complementary value:

| Configuration | Purpose | Target Audience |
|--------------|---------|-----------------|
| **Baseline** (-AGENTS.md -MCP) | Pure model capability | All repos (generic knowledge) |
| **MCP Only** (-AGENTS.md +MCP) | MCP value in undocumented repos | Legacy/undocumented codebases (majority) |
| **AGENTS.md Only** (+AGENTS.md -MCP) | Static instruction effectiveness | AI-forward teams with documentation |
| **Combined** (+AGENTS.md +MCP) | Complementary or conflicting? | Best-case scenario |

**Market Context (2025):**
- AGENTS.md adoption growing among AI-forward teams
- Teams exploring AI will likely create AGENTS.md before installing MCP
- MCP primary value: **Legacy/undocumented codebases** + **validation/discovery** beyond code gen

### Test Steps (Per Configuration)

1. **Setup**: Reset repo `git checkout . && git clean -fd`
2. **Configure**: Enable/disable AGENTS.md and MCP as per test matrix
3. **Execute**: Run universal prompt
4. **Build**: Execute `ng build` (or equivalent)
5. **Score Framework Patterns** (5-point): inject, signals, standalone, Jest, @ssp libs
6. **Score Design System Patterns** (3-point): CodeBlue, design tokens, wrappers
7. **Score Integration** (3-point): routing, navigation, i18n
8. **Record Metrics**: tokens, time, LOC, failures
9. **Note Beyond-Pattern Value**: discovery, validation, hallucination prevention

### Additional Metrics (Beyond Pattern Conformance)

**Discovery & Validation** (MCP's unique value):
- Did MCP prevent service hallucination? (yes/no)
- Pattern quantification provided? ("97% use inject" vs "prefer inject")
- Wrapper warnings shown? ("@codeblue:847 vs primeng:3")
- Architectural guidance? (correct location selection)

**Future Value Indicators**:
- Would benefit from pattern drift tracking? (yes/no)
- Would benefit from anti-pattern detection? (yes/no)
- Would benefit from import validation? (yes/no)

---

## Results

See `TEST_RESULTS_SUMMARY.md` for aggregated data.



### PROMPT TEMPLATE FOR REVIEWING CHANGES:

- Read the @TESTING_FRAMEWORK.md, @SPEC.md and @TEST_RESULTS.md  as well as @TEST_RESULTS_SUMMARY.md to understand the task I'm into.
- I have just ran Gemini 3 Pro in Gemini CLI and it has implemented what's in the Portal uncommited changes. 
- Time taken to complete the task: 5min
- Is it building: yes/no - 
- Analyze the quality on the uncommited changes for the ssp_portal that this specific model outputted and note it down into the test_results_summary and test_results of the SSP_Portal_0712 test session. 
- I have noted what the model told me about it running the MCP tools in @TOOL_CALLS.md last section but do not take it for granted. 
- Be critically objective with it. 