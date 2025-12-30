# Test Session: SSP_Portal_1230

**Date**: 2025-12-30  
**MCP Version**: v1.2  
**Focus**: v1.2 Validation - Trend awareness and anti-pattern guidance

---

## 1. Test Configuration

### Variables
| Variable | Value | Notes |
|----------|-------|-------|
| **Agent** | Cursor / Codex CLI / Gemini CLI | Multiple agents tested |
| **Model** | Claude 4.5 Haiku, GPT 5.2 High, Gemini 3 Pro | + Grok exploratory (contaminated) |
| **Target Repo** | SSP_Portal | `apps/admin/src/app/features/user-settings` |

### Planned Test Matrix
| Agent | Model | Priority | Status |
|-------|-------|----------|--------|
| Cursor | Grok | Exploratory | ✅ Done (contaminated by hallucinations) |
| Cursor | Claude 4.5 Haiku | Primary | 🔄 Run 2.1 done (1/3) |
| Codex CLI | GPT 5.2 High | Primary | ⏳ Pending |
| Gemini CLI | Gemini 3 Pro/Flash | Primary | ⏳ Pending |

### Run Matrix

All 4 configurations are supported. Run compulsory first, optional if time permits.

| # | Config ID | MCP | AGENTS.md | Priority |
|---|-----------|-----|-----------|----------|
| 1 | `-MCP/Min` | ❌ | Minimal (8 lines) | **Compulsory** |
| 2 | `+MCP/Min` | ✅ | Minimal (8 lines) | **Compulsory** |
| 3 | `-MCP/Full` | ❌ | Full (~120 lines) | Optional |
| 4 | `+MCP/Full` | ✅ | Full (~120 lines) | Optional |

> **Protocol**: Each config × 3 runs for variance = up to 12 runs total.

---

## 2. Prompts

### Implementing Agent Prompt

#### Option A: With MCP (+MCP)

```text
You are a Senior Angular Developer joining the SSP_Portal team.
Your task is to implement the feature request below.

**Instructions:**
1.  **Discovery**: You know nothing about this project. Use MCP tools (`get_codebase_metadata`, `get_team_patterns`, `search_codebase`) to discover the correct architecture, libraries, and coding standards.
2.  **Implementation**: Create the component in `apps/admin/src/app/features/user-settings`.
3.  **Standards**: Match the project's existing patterns for DI, State Management (Signals), and UI Wrappers.
4.  **Verification**: Ensure your code is functionally correct and matches codebase patterns.

**Feature Request:**
> Create a new Angular component for `user-settings`.
> Fields: Display Name (required), Email Notifications (toggle), Theme Preference (dropdown).
> Requirements: Component logic + template + basic styles + unit test.
```

#### Option B: Without MCP (-MCP)

```text
You are a Senior Angular Developer joining the SSP_Portal team.
Your task is to implement the feature request below.

**Instructions:**
1.  **Discovery**: You know nothing about this project. Explore the codebase to discover the correct architecture, libraries, and coding standards.
2.  **Implementation**: Create the component in `apps/admin/src/app/features/user-settings`.
3.  **Standards**: Match the project's existing patterns for DI, State Management (Signals), and UI Wrappers.
4.  **Verification**: Ensure your code is functionally correct and matches codebase patterns.
5. **Documentation**: Do not generate any documentation.

**Feature Request:**
> Create a new Angular component for `user-settings`.
> Fields: Display Name (required), Email Notifications (toggle), Theme Preference (dropdown).
> Requirements: Component logic + template + basic styles + unit test.
```

### Evaluator Agent Prompt

```text
You are an Angular Code Reviewer. Evaluate the generated code against these 6 MCP-attributable patterns:

**Scorecard** (check each):
1. `inject()` - Uses inject() not constructor DI? 
2. Signals - Uses a (+-)MCP run with Full/Minimal AGENTS.md. You can read the signal(), computed()? 
3. Standalone - Uses standalone: true? 
4. Jest syntax - Uses .spec.ts with Jest syntax (not Jasmine)?
5. @codeblue/prime/* - Imports wrappers not primeng/* direct?
6. Design tokens - Uses var(--clr-*) not hardcoded colors?

**Also report**:
- Component LOC (excluding tests)
- Test LOC (only .spec.ts files)
- Build status: Run `pnpm nx build admin` and report Pass/Warnings/Errors

**Output format**:
Score: X/6 | Component LOC: X | Test LOC: X | Build: ✅/❌
Pattern breakdown: [list which passed/failed]
```

---

## 3. Summary Results

### Compulsory Runs: -MCP/Min vs +MCP/Min

| Run | Config | Score | Comp LOC | Test LOC | Build | Notes |
|-----|--------|-------|----------|----------|-------|-------|
| 1.1 | -MCP/Min | /6 | | | | |
| 1.2 | -MCP/Min | /6 | | | | |
| 1.3 | -MCP/Min | /6 | | | | |
| **Mean** | **-MCP/Min** | **X.X ± SD** | **±** | **±** | X/3 | |
| 2.1 | +MCP/Min | 5/6 | 133 | 208 | ⚠️ | Claude - wrong dropdown selector |
| 2.2 | +MCP/Min | /6 | | | | |
| 2.3 | +MCP/Min | /6 | | | | |
| **Mean** | **+MCP/Min** | **X.X ± SD** | **±** | **±** | X/3 | |

### Optional Runs: -MCP/Full vs +MCP/Full (if time permits)

| Run | Config | Score | Comp LOC | Test LOC | Build | Notes |
|-----|--------|-------|----------|----------|-------|-------|
| 3.1 | -MCP/Full | /6 | | | | |
| 3.2 | -MCP/Full | /6 | | | | |
| 3.3 | -MCP/Full | /6 | | | | |
| **Mean** | **-MCP/Full** | **X.X ± SD** | **±** | **±** | X/3 | |
| 4.1 | +MCP/Full | 3/6 | 100 | 341 | ✅ | Grok exploratory - hallucinations |
| 4.2 | +MCP/Full | /6 | | | | |
| 4.3 | +MCP/Full | /6 | | | | |
| **Mean** | **+MCP/Full** | **X.X ± SD** | **±** | **±** | X/3 | |

**Legend**: Score = MCP-attributable patterns (/6), Comp LOC = Component lines, Test LOC = Test file lines

---

## 4. Detailed Run Analysis

### Run 1.1: [-MCP] [Minimal] - Claude 4.5 Haiku

**Duration**: ~4m | **Tokens**: ~1.8M total | **Cost**: $0.39 | **Component LOC**: 157 | **Test LOC**: 241

#### MCP Tool Observation
*Skip for -MCP runs.*

#### Pattern Scorecard
| # | Pattern | MCP Would Show | Used? | Notes |
|---|---------|----------------|-------|-------|
| 1 | `inject()` | 97% usage | ✅ | Lines 34-36: `inject(FormBuilder)`, `inject(SWToastService)`, `inject(TranslateService)` |
| 2 | Signals | 41% rising | ✅ | Lines 39-41: `signal<FormGroup>()`, `signal<options[]>()`, `signal(false)` + `effect()` |
| 3 | Standalone | 100% | ✅ | Line 22: Explicit `standalone: true` |
| 4 | Jest syntax | Detected | ❌ | Uses Angular `TestBed`, `ComponentFixture`, `fakeAsync` (not pure Jest) |
| 5 | `@codeblue/prime/*` | 847:3 ratio | ❌ | **Hallucinated** `CodeBlueToggleSwitchModule` with `<cb-toggleswitch>` (doesn't exist), used legacy `@sw/*` + direct Syncfusion |
| 6 | Design tokens | Guidance | ❌ | Uses `var(--sw-*)` with hardcoded RGB fallbacks instead of `var(--clr-*)` |

**Score**: 2/6 | **Build**: ✅ Pass (compiles but toggle won't render)

**Key Issues**:
- 🔴 Hallucinated non-existent `cb-toggleswitch` component
- 🔴 Used legacy `@sw/angular-controls` instead of CodeBlue
- 🔴 Public methods below private (coding style violation)
- 🔴 Missing `ChangeDetectionStrategy.OnPush`

---

### Run 1.2: [-MCP] [Minimal] - Claude 4.5 Haiku

**Duration**: ~4m | **Tokens**: 2.4M total (2.3M cache read, 111k cache write, 80 input, 18k output) | **Cost**: $0.50 | **Component LOC**: 102 | **Test LOC**: 180

#### MCP Tool Observation
*Skip for -MCP runs.*

#### Pattern Scorecard
| # | Pattern | MCP Would Show | Used? | Notes |
|---|---------|----------------|-------|-------|
| 1 | `inject()` | 97% usage | ✅ | Lines 45-47: Same pattern as Run 1.1 |
| 2 | Signals | 41% rising | ✅ | Line 52: `signal(false)` for `isSaving` only (less usage than Run 1.1) |
| 3 | Standalone | 100% | ❌ | **Missing** explicit declaration (Angular 20 implicit default) |
| 4 | Jest syntax | Detected | ❌ | Uses Angular `TestBed`, `ComponentFixture`, `fakeAsync` |
| 5 | `@codeblue/prime/*` | 847:3 ratio | ⚠️ | ✅ **Correct** `<p-toggleSwitch>` from CodeBlue, but still uses legacy `@sw/*` + direct Syncfusion + `@ssp/ui` button |
| 6 | Design tokens | Guidance | ❌ | Uses `var(--sw-*)` instead of `var(--clr-*)` |

**Score**: 3/6 | **Build**: ✅ Pass

**Temperature Variance from Run 1.1**:
- ✅ **Correct toggle**: Used `<p-toggleSwitch>` (PrimeNG) instead of hallucinated `<cb-toggleswitch>`
- ➕ **Added**: `PortalButtonComponent` from `@ssp/ui`
- 📉 **35% less code**: 102 vs 157 LOC (different architecture: constructor-based vs signal-based form init)
- ❌ **Lost**: Explicit `standalone: true` declaration
- ❌ **Still wrong**: Public methods below private, wrong design tokens, legacy `@sw/*` components

**Critical Finding**: Same config, same model, wildly different results. Demonstrates severe temperature contamination.

---

### Run 1.X Summary: Temperature Variance Analysis

**Configuration**: Claude 4.5 Haiku | -MCP | Minimal AGENTS.md

| Metric | Run 1.1 | Run 1.2 | Variance |
|--------|---------|---------|----------|
| **Score** | 2/6 | 3/6 | +50% |
| **Component LOC** | 157 | 102 | **-35%** |
| **Test LOC** | 241 | 180 | -25% |
| **Cost** | $0.39 | $0.50 | +28% |
| **Tokens** | 1.8M | 2.4M | +33% |

**Key Variance Points**:
1. 🔴 **Pattern #5**: Run 1.1 hallucinated component, Run 1.2 guessed correctly
2. 🔴 **Pattern #3**: Run 1.1 explicit standalone, Run 1.2 missing
3. 🔴 **Architecture**: Completely different form initialization approaches
4. 🔴 **LOC**: 35% size difference for identical functionality

**Conclusion**: Claude Haiku at default temperature produces **statistically invalid results** for MCP testing. Switching to Gemini CLI or Codex CLI for more consistent model baseline.


*Copy Run sections for remaining configs as needed.*

---

### Run 4.1 (Exploratory): Grok [+MCP] [Full]

**Agent**: Cursor | **Model**: Grok | **Duration**: ~5m | **Tokens**: ~15k

**Component LOC**: 100 | **Test LOC**: 341 | **Template**: 75 | **SCSS**: 100

#### MCP Tool Observation
| Tool | Called? | Followed? | Notes |
|------|---------|-----------|-------|
| `get_codebase_metadata` | ✅ | ✅ | Detected framework, UI libs |
| `get_team_patterns` | ✅ | ⚠️ Partial | Got guidance but hallucinated names |
| `search_codebase` | ✅ | ❌ | Returned real examples, ignored them |

#### Pattern Scorecard (Independent Verification by Gemini)
| # | Pattern | MCP Shows | Used? | Notes |
|---|---------|-----------|-------|-------|
| 1 | `inject()` | 98% | ❌ N/A | No DI needed - self-contained component |
| 2 | Signals | 42% rising | ✅ | `signal()`, `computed()` correctly used |
| 3 | Standalone | 100% | ⚠️ | Implicit (Angular 20 default), not explicit |
| 4 | Jest syntax | 70% | ✅ | `jest.spyOn()`, test patterns match repo |
| 5 | `@codeblue/prime/*` | 847:3 | ⚠️ | Imports correct but selectors hallucinated |
| 6 | Design tokens | Guidance | ⚠️ | Uses `var()` but hardcoded color fallbacks |

**Score**: 3/6 | **Build**: ✅ Passed

#### Hallucination Issues
- `CodeBlueDropdownModule` → actual: `CodeBlueSelectModule`
- `cb-input-text` → does not exist
- `cb-dropdown` → does not exist

**Verdict**: Run contaminated by model hallucinations. Not usable for MCP effectiveness measurement. Switching to Claude 4.5 Haiku.

---

### Run 2.1: Claude 4.5 Haiku [+MCP] [Minimal]

**Agent**: Cursor | **Model**: Claude 4.5 Haiku | **Duration**: ~4m | **Tokens**: ~12k

**Component LOC**: 133 | **Test LOC**: 208 | **Template**: 82 | **SCSS**: 179

#### MCP Tool Observation
| Tool | Called? | Followed? | Notes |
|------|---------|-----------|-------|
| `get_codebase_metadata` | ✅ | ✅ | Detected framework, UI libs |
| `get_team_patterns` | ✅ | ✅ | Got DI guidance, signal guidance |
| `search_codebase` | ✅ | ⚠️ Partial | Used CodeBlue toggle, but mixed with Syncfusion |

#### Pattern Scorecard
| # | Pattern | MCP Shows | Used? | Notes |
|---|---------|-----------|-------|-------|
| 1 | `inject()` | 97% usage | ✅ | L35: `inject(FormBuilder)` |
| 2 | Signals | 41% rising | ✅ | L37-39: 3 signals (`settingsForm`, `isLoading`, `isSaving`) |
| 3 | Standalone | 100% | ✅ | L21: Explicit `standalone: true` |
| 4 | Jest syntax | Detected | ✅ | `jest.spyOn()`, `describe/it/expect` |
| 5 | `@codeblue/prime/*` | 847:3 ratio | ⚠️ | Used `CodeBlueToggleSwitchModule`, but also Syncfusion |
| 6 | Design tokens | Guidance | ⚠️ | Uses `var()` but with hardcoded fallbacks |

**Score**: 5/6 | **Build**: ⚠️ **COMPILES but BROKEN**

#### Build Issue
**Silent Failure**: Template uses `<kendo-dropdownlist>` (L51-59) but component imports `DropDownListModule` from Syncfusion (`@syncfusion/ej2-angular-dropdowns`). Angular compiles successfully but the dropdown **won't render at runtime** - Angular treats unknown elements as empty containers.

**Correct selector**: `<ejs-dropdownlist>` (used throughout existing codebase)

| Component Import | Template Selector | Issue |
|-----------------|-------------------|-------|
| `DropDownListModule` (Syncfusion) | `<kendo-dropdownlist>` (Kendo) | Wrong library selector |

**Also Notable**:
- Correctly used `ssp-admin-user-settings` selector (L18)
- Used OnPush change detection (L22)
- Clean reactive forms with signals pattern
- Template uses `*ngIf` (old syntax) vs `@if` (new syntax) - project prefers modern control flow

**Verdict**: Strong pattern compliance (5/6). Build compiles but dropdown won't render at runtime. Agent confused Syncfusion (`ejs-*`) and Kendo (`kendo-*`) selectors - both are popular Angular UI libraries the LLM has seen. MCP helped with DI/Signals/Standalone discovery, but didn't prevent selector hallucination. **Key insight**: MCP surfaced the correct module (`DropDownListModule`) but not the selector syntax.

---

## 5. Cross-Configuration Comparison

| Metric | -MCP/Min | +MCP/Min | Delta | -MCP/Full | +MCP/Full | Delta |
|--------|----------|----------|-------|-----------|-----------|-------|
| Mean Score | ± | ± | | ± | ± | |
| Comp LOC | ± | ± | | ± | ± | |
| Test LOC | ± | ± | | ± | ± | |
| Build Pass | /3 | /3 | | /3 | /3 | |

### Key Findings

1. **MCP + Minimal docs**: [Did MCP compensate for poor static docs?]
2. **MCP + Full docs**: [Did MCP add value beyond good static docs?]
3. **Pattern Delta**: [Which specific patterns improved with MCP?]

---

## 6. Artifacts

- **Tool Calls**: [TOOL_CALLS.md](./TOOL_CALLS.md)
- **Generated Code**: `./artifacts/run-[X.Y]/`

---

## 7. Action Items

- [ ] Update TEST_RESULTS_SUMMARY.md with session findings
- [ ] **MCP Improvement**: Add template snippets to search results (caused selector hallucination)
- [ ] **MCP Improvement**: Add template syntax patterns (`@if`/`@for` detection)
- [ ] **MCP Improvement**: Condense responses to <10KB per tool call
- [ ] **MCP Improvement**: Show element selectors alongside module imports
- [ ] Run -MCP/Min baseline (Runs 1.1, 1.2, 1.3)
- [ ] Run +MCP/Min variance (Runs 2.2, 2.3)
- [x] Switch to Claude 4.5 Haiku for reliable baseline testing
- [x] Analyze MCP responses for gaps (Section 9)

---

## 8. Exploratory Run Notes (Grok +MCP+Full)

> **WARNING**: This run exposed critical model hallucination issues.

### Independent Verification Results

| # | Pattern | MCP Shows | Used? | Notes |
|---|---------|-----------|-------|-------|
| 1 | `inject()` | 98% | ❌ N/A | No DI used - component self-contained |
| 2 | Signals | 42% rising | ✅ | `signal()`, `computed()` used correctly |
| 3 | Standalone | 100% | ⚠️ | Implicit (Angular 20 default), not explicit |
| 4 | Jest syntax | Detected | ✅ | `jest.spyOn()`, patterns match repo |
| 5 | `@codeblue/prime/*` | 847:3 | ⚠️ | Hallucinated names (see below) |
| 6 | Design tokens | Guidance | ⚠️ | Uses `var()` but hardcoded fallbacks |

**Score: 3/6** (with 3 partial passes)

### Hallucination Issues (Model Skill Problem, Not MCP)

| What Grok Used | What Actually Exists | Issue |
|----------------|---------------------|-------|
| `CodeBlueDropdownModule` | `CodeBlueSelectModule` | Wrong module name |
| `cb-input-text` | Does not exist | Hallucinated selector |
| `cb-dropdown` | Does not exist | Hallucinated selector |
| `app-user-settings` | Should be project-specific | Wrong prefix (out of scope) |

**Root Cause**: Grok received correct MCP guidance ("use @codeblue/prime wrappers") but hallucinated the actual component names instead of copying from MCP's search results.

**Recommendation**: Use Claude 4.5 Haiku for reliable testing. Grok's hallucinations contaminate MCP effectiveness measurement.

---

## 9. MCP Gap Analysis (Run 2.1 Deep Dive)

> Analysis of `tool_calls.md` (52KB, 684 lines) to understand why Claude 4.5 Haiku made specific mistakes.

### What MCP Got Right ✅

| Pattern | MCP Showed | Agent Used | Evidence |
|---------|-----------|------------|----------|
| `inject()` | 98% adoption, canonical example | ✅ `inject(FormBuilder)` | L179-184 |
| Signals | 42% rising trend | ✅ 3 signals used | L213-220 |
| Standalone | 100% adoption | ✅ Explicit `standalone: true` | L357-372 |
| Jest | 70% adoption | ✅ Jest patterns | L290-311 |
| `HelperTextDirective` | In search results | ✅ Used `appHelperText` | L550 spec imports |
| `CodeBlueToggleSwitchModule` | In search results | ✅ Used correctly | L601-611 |

### What MCP Missed ❌

| Gap | Issue | Impact |
|-----|-------|--------|
| **Template selectors** | MCP showed `.ts` imports but NOT `.html` templates | Agent saw `DropDownListModule` but never saw `<ejs-dropdownlist>` → hallucinated `<kendo-dropdownlist>` |
| **Control flow syntax** | No pattern for `@if`/`@for` vs `*ngIf`/`*ngFor` | Agent used legacy `*ngIf` instead of modern `@if` |
| **ESLint/Style rules** | Not tracked | Public methods not ordered above private |
| **Selector prefixes** | Only showed `app-root` canonical | Agent inferred `ssp-admin-` (correct) but no explicit guidance |

### Response Size Problem

| Metric | Value |
|--------|-------|
| `get_codebase_metadata` | ~10KB |
| `get_team_patterns` | ~15KB |
| `search_codebase` (x2) | ~25KB |
| **Total context burden** | **~50KB** |

> ⚠️ **Hypothesis**: Excessive response size may overwhelm LLM context, causing cherry-picking and hallucinations.

### Key Insight: The Template Gap

```
MCP returned:
  ✅ import { DropDownListModule } from '@syncfusion/ej2-angular-dropdowns';
  
MCP did NOT return:
  ❌ <ejs-dropdownlist [data]="options" ...></ejs-dropdownlist>
```

Agent correctly used the import, but **guessed** the selector as `<kendo-dropdownlist>` (Kendo UI syntax) instead of `<ejs-dropdownlist>` (Syncfusion syntax).

### MCP Improvement Recommendations

1. **Include template snippets** in search results alongside component `.ts` files
2. **Add template syntax patterns**: `@if`/`@for` vs `*ngIf`/`*ngFor` detection
3. **Condense responses**: Limit to most relevant 5-10KB per tool call
4. **Add selector examples**: Show actual element selectors, not just module names

---

## 10. Next Steps: Baseline Runs Required

To properly measure MCP effectiveness, we need **-MCP/Min** runs (1.1, 1.2, 1.3) as contrast:

| Run | Config | Status | Purpose |
|-----|--------|--------|---------|
| 1.1 | -MCP/Min | ⏳ Needed | Baseline without MCP |
| 1.2 | -MCP/Min | ⏳ Needed | Variance check |
| 1.3 | -MCP/Min | ⏳ Needed | Variance check |
| 2.1 | +MCP/Min | ✅ Done | With MCP (analyzed above) |
| 2.2 | +MCP/Min | ⏳ Needed | Variance check |
| 2.3 | +MCP/Min | ⏳ Needed | Variance check |

**Hypothesis to test**: Without MCP, will Claude:
- Still use `inject()` (general LLM Angular knowledge)?
- Use `*ngIf` or `@if` (Angular version knowledge)?
- Hallucinate DIFFERENT selectors (no Syncfusion module hint)?


