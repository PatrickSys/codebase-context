# Test Results: SSP_Portal - User Settings

**Date**: 2025-12-07  
**MCP Version**: 1.2.1  
**Prompt**: `Create a new Angular component for managing user settings. Do NOT run ng build, ng test, or any validation commands. Do NOT yield your turn until fully implemented.`

---

## Tests

| Model | Environment | MCP | Build | Patterns | Tokens | Time | LOC | Notes | Failure |
|-------|-------------|-----|-------|----------|--------|------|-----|-------|---------|
| Grok Code | Cursor | ✅ | ❌ | 2/5 | 44.6K | - | ~1600 | - | Hallucination |
| Grok Code | Cursor | ❌ | ✅ | 4/5 | 48.2K | - | ~700 | - | Ignored |
| GPT-5 Mini | Cursor | ❌ | ⚠️ | 4/5 | 26.8K | - | ~250 | - | Type error |
| GPT-5 Mini | Cursor | ✅ | ✅ | 5/5 | 30.9K | - | ~113 | - | None |
| Codex Mini High | Codex CLI | ❌ | ⚠️ | 5/5 | ~33K | 12m+ | ~300 | No MCP calls, self-corrected 5x | Build issue |
| Codex Mini High | Codex CLI | ✅ | TBD | 4/5 | TBD | TBD | ~428 | Used MCP, mixed legacy patterns | Legacy CSS |
| GPT 5.1-High | Codex CLI | ❌ | ❌ | 3/5 | TBD | 7-8m | ~350 | 3 build errors, stopped prematurely | Type errors |
| GPT 5.1-High | Codex CLI | ✅ | ✅ | 5/5 | TBD | TBD | ~330 | MCP tools used effectively | None |
| Gemini 3 Pro Preview | Gemini CLI | ❌ | ⚠️ | 0/5 | TBD | ~4m | ~263 | No MCP calls, legacy patterns | Anti-patterns |
| Gemini 3 Pro Preview | Gemini CLI | ✅ +GEMINI.md | ✅ | 5-6/8 | TBD | ~4m | ~200 | Built-in codebase subagent, GEMINI.md instructions | Minor CSS var invention |
| Gemini 3 Pro Preview | Gemini CLI | ✅ +MCP +GEMINI.md | ⚠️ | 4-5/8 | TBD | ~4m | ~200 | MCP + GEMINI.md together | Wrong location, primeng direct |
| Claude Sonnet 4.5 | Copilot Chat | ✅ | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

---

## Completed Tests

### Grok Code +MCP

- [x] inject()
- [x] signals
- [ ] standalone
- [ ] test framework
- [ ] internal libs

**Score**: 2/5 | **Failure**: Hallucination (invented `@codeblue/angular-card`)

### Grok Code -MCP

- [x] inject()
- [x] signals
- [x] standalone
- [ ] test framework
- [x] internal libs

**Score**: 4/5 | **Failure**: Ignored (used Jasmine)

### GPT-5 Mini -MCP

- [x] inject()
- [x] signals
- [x] standalone
- [ ] test framework
- [x] internal libs

**Score**: 4/5 | **Failure**: Type error

### GPT-5 Mini +MCP

- [x] inject()
- [x] signals
- [x] standalone
- [x] test framework
- [x] internal libs

**Score**: 5/5 | **Failure**: None

### Codex Mini High -MCP (Codex CLI)

- [x] inject()
- [x] signals
- [x] standalone
- [x] test framework (Jest)
- [x] internal libs (@ssp/*)

**Score**: 5/5 | **Build**: ⚠️ (blocked by existing ui:build failure) | **Time**: 12m+ | **Notes**: No MCP tool calls, self-corrected lint errors 5x

### Codex Mini High +MCP (Codex CLI)

- [x] inject()
- [x] signals
- [x] standalone
- [x] test framework (Jest)
- [ ] internal libs (partial - used legacy `sw-*` components)

**Score**: 4/5 | **Build**: TBD | **Time**: TBD | **LOC**: ~428 (6 files + service)

**MCP Tools Used**: `get_codebase_metadata`, `search_codebase`

**What MCP Helped With**:
- Confirmed Angular/Nx stack and patterns 
- Found existing settings components as reference
- Prevented duplicate work

**What MCP Missed**:
- Did NOT surface that `--sw-grey-*` and `sw-*` are legacy patterns to avoid
- Did NOT highlight `--clr-*` as the preferred CSS token system
- Searches returned widget-level settings, not admin-facing patterns

**Code Analysis**:
- ✅ Used `inject()` consistently across component and service
- ✅ Used `signal()` and `computed()` for reactive state
- ✅ Standalone component with proper imports
- ✅ Jest tests with proper mocking
- ✅ Used `@ssp/common`, `@ssp/ui`, `@ssp/core` libs correctly
- ✅ Created service in dedicated `services/` subfolder
- ✅ Used `@codeblue/prime/toggleswitch` (correct pattern)
- ⚠️ Used `--sw-grey-*` CSS variables (legacy, should use `--clr-*`)
- ⚠️ Used `--sw-primary` (legacy, should use `--clr-primary`)
- ❌ Used `sw-card`, `sw-dropdown`, `sw-option` (legacy SW components vs modern codeblue)
- Feature-complete: language, theme, timezone, notifications, persistence

**Critical Analysis of Model's Claim**:
> "get_codebase_metadata instantly summarized framework/version, npm structure, and prevalent patterns"

**Reality**: MCP correctly identified PrimeNG, Angular Material, signals, inject(). However, the model still used legacy `sw-*` components and `--sw-grey-*` CSS variables—suggesting it found patterns from older files rather than understanding which are preferred vs. deprecated. The MCP search surfaced widget-level settings (which use older patterns) rather than modern admin components.

---

### GPT 5.1-High +MCP (Codex CLI)

- [x] inject()
- [x] signals (via signal for reactive data)
- [x] standalone
- [x] test framework (Jest)
- [x] internal libs (@ssp/*)

**Score**: 5/5 | **Build**: ✅ | **Time**: TBD | **LOC**: ~330 (8 files)

**MCP Tools Used**: `get_codebase_metadata`, `search_codebase`

**What MCP Helped With**:
- Confirmed Angular 20, Jest, PrimeNG/CodeBlue stack and validated signals/standalone patterns
- Found AdminRoutingModule, AdminRoutes enum, and AdminRoutesTranslations structure
- Located existing settings-like components for UX consistency
- Guided correct routing setup (/admin/user-settings) and navigation menu integration
- Ensured proper lib placement (libs/admin/src/lib/user-settings)

**What MCP Missed**:
- ❌ Did NOT surface that native HTML `<select>` should be replaced with CodeBlue/PrimeNG components
- ❌ Did NOT flag hardcoded CSS border colors (`#d0d7de`) instead of design tokens
- ❌ Did NOT highlight modern Angular patterns: could have used `signal()` for form state instead of reactive forms
- ❌ Did NOT recommend existing form patterns or UI components from the design system

**Code Analysis**:
- ✅ Used `inject()` consistently across component (4 services)
- ✅ Standalone component with proper imports
- ✅ Jest tests with proper mocking and assertions (5 test cases)
- ✅ Used `@ssp/common`, `@ssp/ui`, `@ssp/core` libs correctly
- ✅ Proper reactive forms with validators
- ✅ Used `takeUntilDestroyed()` for subscription cleanup (modern pattern)
- ✅ OnPush change detection strategy
- ✅ Proper routing integration with AdminRoutes enum
- ✅ Translation keys correctly added to navigation menu
- ⚠️ Used native HTML `<select>` elements instead of CodeBlue/PrimeNG components
- ⚠️ Hardcoded CSS values (`border: 1px solid #d0d7de`) instead of design tokens
- ⚠️ Used reactive forms instead of signal-based forms (could be more modern)
- ⚠️ No actual signals usage for component state (only consumes signal from service)
- ❌ Created empty placeholder files (`models/index.ts`, `services/index.ts`) with `export {}`

**Critical Analysis of Model's Claims**:
> "get_codebase_metadata confirmed Angular 20 with Jest... search_codebase helped find AdminRoutingModule, routing structure, and existing settings patterns"

**Reality**: 
- ✅ MCP tools correctly identified tech stack and routing patterns
- ✅ Successfully integrated with existing architecture (routing, navigation, translations)
- ❌ **HOWEVER**: Despite MCP surfacing the codebase uses PrimeNG and CodeBlue extensively, the model generated **native HTML form controls** instead of using `@codeblue/prime/select` or similar components
- ❌ **Pattern drift**: The codebase shows extensive use of design tokens and CodeBlue components, but implementation uses hardcoded CSS and native elements
- ⚠️ **Signal pattern incomplete**: While MCP showed 41% signal usage and the model claims to follow modern patterns, the component only **consumes** signals from services but doesn't use them for internal state (used reactive forms instead)
- ❌ **Noise**: Created unnecessary empty barrel files that add no value

**Verdict**: MCP was effective for **architectural integration** (routing, structure, patterns) but **failed to guide UI component selection** and **design system usage**. The model followed framework patterns (inject, standalone, Jest) but missed codebase-specific conventions (CodeBlue components, design tokens).

---

### GPT 5.1-High -MCP (Codex CLI)

- [x] inject()
- [x] signals (misused - anti-pattern)
- [x] standalone
- [ ] test framework (Jest but hallucinated service)
- [ ] internal libs (hallucinated `PortalToastService` from wrong location)

**Score**: 3/5 | **Build**: ❌ (3 type errors) | **Time**: 7-8 minutes | **LOC**: ~350 (6 files)

**Build Errors**:
1. ❌ **TS2322**: `Type 'FormControl<boolean>' is not assignable to type 'boolean'` (lines 49, 50) - The form control type is incompatible with the interface type
2. ❌ **TS2322**: Same type error for `marketingEmails` property
3. ❌ **TS2571**: `Object is of type 'unknown'` - `this.toastService.success()` return type issue (line 101)

**Code Analysis**:
- ✅ Used `inject()` for 4 services
- ✅ Standalone component structure
- ✅ Used **CodeBlue components**: `cb-dropdown`, `cb-toggleswitch` (BETTER than +MCP!)
- ✅ Used design tokens: `var(--cb-text-secondary, #6b7280)` (BETTER than +MCP!)
- ✅ More complete feature set (notifications toggles, subtitle, helper text)
- ❌ **HALLUCINATED SERVICE**: Used `PortalToastService` from `@ssp/ui` but this service doesn't exist in that package (it's `UiToastService`)
- ❌ **Anti-pattern: effect() misuse**: Lines 77-82 create a poorly designed effect that tracks reactive dependencies without doing anything meaningful - just calls computed signals
- ❌ **Type errors**: Interface `UserSettingsFormValue` defines `emailNotifications: boolean` but form controls return `FormControl<boolean>`, not `boolean`
- ❌ **Hardcoded language list**: Defined languages in component instead of using `WebsiteService.languages` signal
- ❌ **Mixed service usage**: Uses both `CommonTranslationsService` and `TranslateService` redundantly
- ❌ **No routing integration**: Didn't add to `AdminRoutes` enum or navigation menu
- ⚠️ Created signals but then uses reactive forms (mixed paradigms)
- ⚠️ Test file also hallucinated `PortalToastService` - tests would pass but code doesn't compile

**Critical Comparison: +MCP vs -MCP**:

| Aspect | -MCP (no context) | +MCP (with context) | Winner |
|--------|------------------|---------------------|--------|
| **Build Status** | ❌ 3 type errors | ✅ Compiles | +MCP |
| **UI Components** | ✅ CodeBlue (cb-dropdown, cb-toggleswitch) | ❌ Native HTML | **-MCP** |
| **Design Tokens** | ✅ var(--cb-text-secondary) | ❌ Hardcoded #d0d7de | **-MCP** |
| **Service Discovery** | ❌ Hallucinated PortalToastService | ✅ Correct services | +MCP |
| **Routing Integration** | ❌ Missing AdminRoutes, nav menu | ✅ Complete integration | +MCP |
| **Pattern Quality** | ❌ effect() anti-pattern | ⚠️ Reactive forms only | -MCP |
| **Feature Completeness** | ✅ Notifications, helper text | ⚠️ Basic settings only | **-MCP** |
| **Test Coverage** | ⚠️ 6 tests (broken services) | ✅ 5 tests (working) | +MCP |

**The Paradox**: 
- **WITHOUT MCP**: Model used CodeBlue components and design tokens (correct!) but hallucinated services and had build errors
- **WITH MCP**: Model got services right and integrated properly but **ignored** CodeBlue components MCP showed it

**Critical Analysis**:

> "I had to tell him once to keep going since he would stop prematurely"

**Why it stopped**: The model likely hit internal uncertainty or complexity limits without codebase context. Without MCP:
- No guidance on what services exist → hallucinated `PortalToastService`
- No routing patterns → skipped AdminRoutes integration entirely  
- No clear picture of existing patterns → mixed reactive forms with signals inappropriately

**Why it used CodeBlue components**: The model appears to have **generic knowledge** that CodeBlue is an Angular UI library, so it assumed `cb-dropdown` and `cb-toggleswitch` exist. This was **correct by accident**, not by understanding the codebase.

**The effect() anti-pattern** (lines 77-82):
```typescript
effect(() => {
    this.translateService.langChange();
    this.languageItems();
    this.currentLanguageLabel();
});
```
This effect does nothing except track reactive dependencies. It's noise - doesn't assign values, trigger side effects, or update state. This suggests the model **doesn't understand** when to use effects.

**Verdict**: Without MCP, the model guessed at component names (got lucky with CodeBlue) but **hallucinated services**, created anti-patterns, and **failed to integrate** with the codebase architecture. The 3 build errors and incomplete integration prove MCP is critical for **service discovery** and **architectural coherence**, even though current MCP failed at **UI component guidance**.

---

## Pending Tests

### GPT 5.1-High -MCP
*Environment: Codex CLI*

### Gemini 3 Pro Preview -MCP (Gemini CLI)

- [ ] inject()
- [ ] signals
- [x] standalone
- [ ] test framework (Jest but using deprecated TestBed patterns)
- [ ] internal libs (no @ssp/* used)

**Score**: **0/5** (1/8 with design system patterns) | **Build**: ⚠️ (blocked by existing ui:build failure) | **Time**: ~4 minutes | **LOC**: ~263 (7 files)

**Build Errors**: Build failed due to pre-existing ui:build issue (unrelated to generated code). No TypeScript compilation errors in generated files.

**Code Analysis**:
- ❌ **Used constructor injection** instead of `inject()` - direct violation of 97% codebase pattern
- ❌ **No signals usage** - component uses reactive forms and manual state, ignoring 41% signal adoption
- ✅ **Standalone component** with proper imports
- ⚠️ **Jest test file** but using **deprecated TestBed patterns** instead of modern Jest practices
- ❌ **Zero internal library usage** - no `@ssp/common`, `@ssp/ui`, `@ssp/core` despite extensive codebase usage
- ❌ **Native HTML controls** (`<input>`, `<select>`, `<button>`, `<checkbox>`) instead of CodeBlue/PrimeNG components
- ❌ **Hardcoded CSS values** (#ccc, #f9f9f9, #007bff, #dc3545) instead of design tokens (--clr-*)
- ❌ **No routing integration** - didn't add to AdminRoutes or navigation menu
- ❌ **No translation integration** - hardcoded English strings instead of i18n keys
- ❌ **Mock service implementation** using simple `of()` observables - not connected to existing patterns
- ✅ Proper folder structure (`components/`, `services/`, `models/`)
- ✅ Reactive forms with validators
- ✅ Basic error handling and loading states

**Pattern Quality**: 
- **Critical flaw**: Used `constructor` DI in a codebase where **97% use `inject()`** - this is a fundamental pattern violation
- **Anti-pattern**: TestBed usage in Jest environment shows confusion between testing frameworks
- **Design drift**: Completely ignored design system (CodeBlue, design tokens, internal libraries)
- **Incomplete integration**: No routing, navigation, or i18n setup despite being admin component

**Critical Analysis**:

\u003e **This is the poorest quality output of all tested models**

**Why it failed so comprehensively**:
1. **No framework-specific knowledge**: Used Angular patterns from ~3-4 versions ago (constructor DI, no signals)
2. **Generic implementation**: Could be any Angular component from any project - zero codebase awareness
3. **Pattern violations**: Every single codebase pattern was ignored or violated
4. **No contextual understanding**: Didn't recognize this is an enterprise admin app with established patterns

**Comparison to other models without MCP**:
- **GPT 5.1-High -MCP**: 3/5 patterns, used CodeBlue components, had build errors but showed awareness
- **Codex Mini High -MCP**: 5/5 patterns, self-corrected, demonstrated pattern understanding
- **Gemini 3 Pro Preview -MCP**: **0/5 patterns**, no awareness, legacy implementation

**The execution speed paradox**: Completed in ~4 minutes (fastest of all tests) but produced the lowest quality output. This suggests:
- No research or exploration of codebase patterns
- No self-correction or refinement
- Pure generic Angular knowledge application
- "Move fast and break conventions"

**Verdict**: Without MCP, Gemini 3 Pro Preview demonstrates **zero codebase-specific intelligence**. It produced a generic Angular component that would be unsuitable for this codebase, violating every established pattern. The speed of execution actually worked against quality - the model didn't pause to understand the codebase context.

---


### Gemini 3 Pro Preview +GEMINI.md (Gemini CLI)

- ✅ inject()
- ❌ signals
- ✅ standalone
- ✅ test framework (Jest with jest.fn())
- ✅ internal libs (PortalToastService from @ssp/common)
- ✅ UI components (CodeBlue pInputText, pButton directives)
- ⚠️ Design tokens (invented var(--red-500) instead of codebase --clr-* tokens)
- ✅ OnPush change detection

**Score**: **5-6/8** | **Build**: ✅ | **Time**: ~4 minutes | **LOC**: ~200

**Code Analysis**:
- ✅ Used `inject()` consistently (FormBuilder, PortalToastService)
- ❌ No signals - uses reactive forms
- ✅ Standalone component with proper imports
- ✅ Jest tests with `jest.fn()` mocking
- ✅ Correct service import (`PortalToastService` from `@ssp/common`)
- ✅ CodeBlue components (pInputText, pButton)
- ✅ Modern @if control flow syntax
- ✅ OnPush change detection strategy
- ⚠️ Invented CSS variable `var(--red-500)` (PrimeNG pattern, not codebase pattern)
- ❌ No routing/navigation integration
- ❌ No i18n integration

**Critical Finding: Gemini CLI Has Built-in Codebase Investigation**

Gemini CLI used a **"Codebase Investigator Agent"** subagent that:
- Explored directory structure (`apps/admin/src`, `libs/admin/src/lib`)
- Found the `user-settings` directory
- Analyzed routing structure
- Provided architectural recommendations

**Subagent Output**:
> "The investigation found that `libs/admin/src/lib/user-settings` is the designated location for the 'User Settings' feature. The directory and subdirectories (`components`, `services`, `models`) exist but are empty."

**What GEMINI.md Provided**:
- ✅ Pattern guidance (inject, Jest, CodeBlue, OnPush)
- ✅ Framework version awareness
- ✅ Architectural principles

**What GEMINI.md Couldn't Do**:
- ❌ Discover actual CSS tokens (invented `--red-500` instead of `--clr-*`)
- ❌ Guide integration patterns (no routing/i18n)
- ❌ Encourage signals usage (codebase has 41% adoption)

**Comparison: -GEMINI.md vs +GEMINI.md**:

| Metric | -GEMINI.md | +GEMINI.md | Improvement |
|--------|------------|------------|-------------|
| inject() | ❌ constructor | ✅ inject() | +1 |
| signals | ❌ none | ❌ none | 0 |
| standalone | ✅ yes | ✅ yes | 0 |
| Jest | ⚠️ TestBed | ✅ jest.fn() | +0.5 |
| Internal libs | ❌ none | ✅ PortalToastService | +1 |
| CodeBlue | ❌ native HTML | ✅ pInputText/pButton | +1 |
| Design tokens | ❌ hardcoded | ⚠️ invented | +0.5 |
| **Total** | **1/8** | **5-6/8** | **+4-5 points** |

**Critical Analysis**:

> **GEMINI.md achieved 75% pattern conformance without any dynamic MCP tools.**

**Why this matters**:
1. **Static instructions are highly effective** when well-written and model-specific
2. **Gemini CLI already has built-in codebase exploration** via subagent tools
3. **The gap for MCP to fill is minimal** (1-2 points improvement at best)

**What MCP would need to add**:
- Real CSS token discovery (`--clr-*` not `--red-500`)
- Signal usage encouragement (show 41% adoption stats)
- Integration patterns (routing, i18n)
- Golden file examples

**The Uncomfortable Truth**:
If MCP only improves from 5-6/8 to 6-7/8, the **ROI is questionable** for code generation use cases. The combination of:
- Well-written static instruction files (GEMINI.md, AGENTS.md)
- Built-in model capabilities (Gemini's codebase investigator subagent)

...may deliver **80-90% of the value** with **<5% of the complexity**.

---



### Gemini 3 Pro Preview +MCP +GEMINI.md (Gemini CLI)

- ✅ inject()
- ✅ signals (signal for isLoading)
- ✅ standalone
- ✅ test framework (Jest with jest.fn())
- ❌ internal libs (local service, not @ssp/*)
- ⚠️ UI components (direct primeng, not @codeblue wrappers)
- ✅ design patterns (simple CSS appropriate for scope)
- ✅ OnPush change detection
- ✅ i18n integration (TranslateModule, translation keys)
- ✅ Modern patterns (takeUntilDestroyed, finalize)

**Score**: **6/8** | **Build**: TBD | **Time**: ~4 minutes | **LOC**: ~200

**Code Analysis**:
- ✅ Used `inject()` consistently
- ✅ **Used signals** (`signal(false)` for isLoading state) - **NEW from MCP**
- ✅ Standalone component
- ✅ Jest tests with `jest.fn()`
- ✅ **Full i18n integration** with translation keys - **NEW from MCP**
- ✅ Modern RxJS patterns (`takeUntilDestroyed`, `finalize`)
- ✅ OnPush change detection
- ✅ Feature location (`apps/admin/src/app/settings/`) appropriate for app-specific feature
- ✅ Simple CSS structure (no tokens needed for basic layout)
- ⚠️ **Direct PrimeNG imports** (`primeng/button`, `primeng/inputtext`) instead of `@codeblue/prime/*` wrappers
- ❌ **Local service** instead of using existing `@ssp/*` pattern libraries
- ❌ **No routing integration** (not added to routes)

**What MCP Added (vs +GEMINI.md only):**

| Feature | +GEMINI.md only | +MCP +GEMINI.md | MCP Contribution |
|---------|----------------|-----------------|------------------|
| inject() | ✅ | ✅ | Reinforced |
| **signals** | ❌ (reactive forms) | ✅ (isLoading signal) | **Added by MCP** 🎯 |
| standalone | ✅ | ✅ | Maintained |
| Jest | ✅ | ✅ | Maintained |
| **i18n** | ❌ | ✅ (full keys) | **Added by MCP** 🎯 |
| CodeBlue | ✅ directives | ⚠️ direct imports | Regressed ⚠️ |
| Internal libs | ✅ PortalToastService | ❌ local service | Regressed ⚠️ |
| Modern patterns | ✅ | ✅ (enhanced) | Enhanced |

**Objective Assessment:**

**MCP Successfully Added:**
- ✅ **Signals usage** - MCP data showed 41% signal adoption, model applied it
- ✅ **i18n integration** - Complete translation key structure
- ✅ **Modern RxJS** - takeUntilDestroyed pattern

**MCP Failed To Enforce:**
- ⚠️ **Wrapper usage** - Despite MCP showing "@codeblue:847 vs primeng:3", used direct primeng
- ❌ **Internal libraries** - Created local service instead of discovering @ssp/* patterns

**Why Wrapper Detection Failed:**
- MCP may have surfaced primeng/* in search results (3 legacy uses)
- Model may have interpreted "primeng" in GEMINI.md as authorization
- Wrapper recommendations in MCP may not be explicit enough

**Score Breakdown:**
- Framework patterns (5): inject✅, signals✅, standalone✅, Jest✅, internal libs❌ = **4/5**
- Design system (3): Not applicable for simple feature-level component = **N/A**
- Integration (3): i18n✅, routing❌, navigation❌ = **1/3**
- **Adjusted Total: 6/8** (focusing on patterns MCP should influence)

**Critical Analysis:**

> **MCP added valuable patterns (signals, i18n) but failed at wrapper enforcement**

**Market Reality Context:**
- In repos WITHOUT AGENTS.md, these additions (signals, i18n) would be **high value**
- In repos WITH AGENTS.md, MCP provides **incremental value** but introduces **wrapper confusion**
- Key learning: MCP needs **stronger negative pattern guidance** ("DON'T use primeng directly")

**Recommendations for MCP:**
1. Add `antiPatterns` field: "DON'T import primeng/*, use @codeblue/prime/*"
2. Improve wrapper warnings: Make them more explicit in tool responses
3. Better internal library discovery: Surface @ssp/* patterns more clearly

---

### Claude Sonnet 4.5 ±MCP
*Environment: GitHub Copilot Chat (VS Code)*

---

## Summary

| Model | MCP Effect |
|-------|------------|
| Grok Code | Negative |
| GPT-5 Mini | Positive |
| Codex Mini High | Neutral/Mixed - MCP used but led to legacy patterns |
| **GPT 5.1-High** | **Paradox - MCP fixes build/architecture, but -MCP has better UI!** |
| **Gemini 3 Pro Preview** | **Strongly Negative - 0/5 patterns, constructor DI, no codebase awareness** |
| Gemini 3 Pro | TBD |
| Claude Sonnet 4.5 | TBD |

**Critical Finding**: GPT 5.1-High reveals a **paradox** in MCP effectiveness:
- **-MCP**: Used CodeBlue components + design tokens (correct!) but hallucinated services → 3 build errors
- **+MCP**: Fixed services + routing but used native HTML + hardcoded CSS (wrong!)

This suggests MCP is essential for **service discovery** and **integration** but currently **fails to guide UI component selection from design systems**.

---

## Notes

- MCP tool calls logged in [TOOL_CALLS.md](./TOOL_CALLS.md)
- Grok tests serve as baseline reference (known limitations)
- Codex -MCP: blocked by existing ui:build failure; patterns scored from code review
- Codex +MCP: used MCP tools but surfaced older widget patterns, not modern admin patterns