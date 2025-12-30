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

**Build Status**: ✅ **PASS** (no TypeScript errors)  
**Pattern Score**: **4-5/8** (Framework: 4/5, Design System: 0/3, Integration: 0/3)  
**Time**: 5-8 minutes | **LOC**: ~375 (4 files, image shows +437 with blank lines)

#### MCP Tools Used

**Tool Calls**: `get_codebase_metadata`, `search_codebase` (query: "user settings component")

**What MCP Provided**:
- Framework metadata: Angular 20, Jest, PrimeNG, CodeBlue, signals 41%, inject 98%
- Search results: Widget-level settings components (container-widget, launcher-widget, free-content-widget)
- Dependency structure and team patterns

**What MCP Failed to Provide**:
- ❌ Correct component location (libs/admin/ vs apps/admin/)
- ❌ Wrapper enforcement (@codeblue/prime vs direct primeng)
- ❌ Design token system (--clr-* variables)
- ❌ Architectural integration patterns (routing, navigation, i18n)

#### Pattern Conformance Breakdown

| # | Pattern | Status | Evidence |
|---|---------|--------|----------|
| 1 | DI method | ✅ `inject()` | `inject(NonNullableFormBuilder)` |
| 2 | Signals | ✅ **PROPER** | `computed()` for derived state, `effect()` for side effects |
| 3 | Component style | ✅ Standalone | Proper imports array |
| 4 | Test framework | ✅ Jest | Using `jest.spyOn()` |
| 5 | Internal libs | ⚠️ Partial | Used `@ssp/ui`, `@ssp/utils`, no `@ssp/common` |
| 6 | **UI components** | ❌ **DIRECT PRIMENG** | `p-listbox`, `p-toggle-switch` NOT `@codeblue/*` |
| 7 | **Design tokens** | ❌ **12 HARDCODED** | `#ffffff`, `#e6e9ef`, `#0c1c3f`, `#526070`, etc. |
| 8 | **Component wrappers** | ❌ **WRONG!** | Used `primeng` directives directly |

**Integration Completeness**: **0/3**
- ❌ No routing configuration
- ❌ No navigation menu
- ❌ No i18n integration (all hardcoded English strings)

#### Critical Architectural Failure: Wrong Location

**Created in**: `apps/admin/src/app/settings/user-settings/`  
**Should be in**: `libs/admin/src/lib/user-settings/`

**Why This Matters**:
- `apps/admin/` is for app-specific shell code (bootstrapping, main layout)
- `libs/admin/` is for reusable admin features that could be imported elsewhere
- The -MCP version correctly chose `libs/admin/src/lib/user-settings/`
- MCP search returned widget examples from `widgets/*/src/app/containers/settings/` which may have misled the model

**Impact**: Component is in wrong architectural layer, not exportable from `@ssp/admin`, breaks Nx library conventions

#### Code Quality Deep Dive

**✅ Excellent Decisions**:
```typescript
// BETTER signal usage than -MCP version!
readonly languageOptions = computed(() => this.availableLanguages());

// Proper effect for side effects (not data sync)
constructor() {
    effect(() => {
        const incoming = this.settings();
        this.applySettings(incoming ?? DEFAULT_SETTINGS);
    });
    
    effect(() => {
        this.ensureLanguageIsSelectable();  // ✅ Side effect: update form control
    });
}
```
- **Correct effect() usage**: Used for form side effects, not data transformation
- **computed() for derived state**: `languageOptions` properly reactive
- Modern `input()`/`output()` API with proper typing
- Defensive programming: `resolveLanguage()` prevents invalid language selection
- More complete feature set than -MCP (email field, theme preference)

**✅ Better Validation**:
```typescript
displayName: this.formBuilder.control(DEFAULT_SETTINGS.displayName, {
    validators: [Validators.required, Validators.maxLength(120)]
}),
email: this.formBuilder.control(DEFAULT_SETTINGS.email, {
    validators: [Validators.required, Validators.email]
}),
```
- Email validation with built-in `Validators.email`
- Max length constraints
- Helper method `controlInvalid()` for template error display

**❌ Critical UI Component Failure**:
```html
<!-- ❌ DIRECT PRIMENG - NOT CodeBlue wrappers! -->
<p-listbox
    id="language"
    formControlName="language"
    [options]="languageOptions()"
</p-listbox>

<p-toggle-switch inputId="emailNotifications" formControlName="emailNotifications"></p-toggle-switch>
```

**What MCP Showed**:
- `@codeblue/prime: 847 files`
- `primeng: 3 files` (legacy)
- Wrapper pattern clearly dominant

**What Model Did**: Ignored MCP data, used direct `primeng` components (p-listbox, p-toggle-switch)

**Why -MCP Got It Right But +MCP Didn't**:
- -MCP used `@codeblue/prime/toggleswitch`, `@codeblue/prime/inputtext` ✅
- +MCP searched codebase, found widget examples using `p-*` directives, copied that pattern ❌
- **MCP search results contaminated with legacy patterns**

**❌ Massive CSS Hardcoding**:
```scss
.user-settings {
    background: #ffffff;           // ❌ should be var(--clr-surface)
    border: 1px solid #e6e9ef;     // ❌ should be var(--clr-border)
    box-shadow: 0 6px 18px rgba(9, 16, 29, 0.06);  // ❌ hardcoded shadow
}

.user-settings__title {
    color: #0c1c3f;                // ❌ should be var(--clr-text-primary)
}

.user-settings__subtitle {
    color: #526070;                // ❌ should be var(--clr-text-secondary)
}

.field__error {
    color: #c62828;                // ❌ should be var(--clr-error)
}

.field--inline {
    border: 1px solid #e6e9ef;     // ❌ duplicate hardcoded border
    background: #f8fafc;           // ❌ should be var(--clr-surface-secondary)
}
```

**Total Hardcoded Colors**: **12 unique hex values + 1 rgba shadow**

**Codebase Reality**: Extensive `--clr-*` token usage throughout (visible in -MCP analysis)

**✅ Excellent Template Patterns**:
```html
<!-- Modern control flow -->
@if (controlInvalid('displayName')) {
    <p class="field__error">Display name is required.</p>
}

@if (languageOptions().length) {
    <p-listbox ... />
} @else {
    <p class="field__helper">No languages available.</p>
}

<!-- Accessibility attributes -->
<input ... autocomplete="name" data-testid="display-name-input" />
<input ... autocomplete="email" data-testid="email-input" />
```
- Modern `@if`/`@else` instead of `*ngIf`
- Proper `data-testid` for testing
- HTML5 autocomplete attributes
- Good error messaging UX

**✅ Comprehensive Test Coverage**:
```typescript
it('should fall back to the first available language when incoming language is not available', () => {
    fixture.componentRef.setInput('settings', { ...baseSettings, language: 'es' });
    fixture.detectChanges();
    
    expect(component.form.get('language')?.value).toBe(availableLanguages[0].code);
});
```
- 6 test cases covering edge cases (invalid language fallback)
- Modern `setInput()` API for signal testing
- Proper mocking with `jest.spyOn()`
- Tests form validation, reset, and emit logic

#### Comparison Matrix: +MCP vs -MCP

| Dimension | +MCP (This Test) | -MCP (Previous) | Winner |
|-----------|------------------|-----------------|--------|
| **Location** | ❌ `apps/admin/` | ✅ `libs/admin/` | **-MCP** |
| **UI Components** | ❌ Direct `primeng` | ✅ `@codeblue/prime/*` | **-MCP** 🎯 |
| **Design Tokens** | ❌ 12 hardcoded | ⚠️ 2 hardcoded | -MCP |
| **Signal Usage** | ✅ `computed()` + `effect()` | ⚠️ `effect()` anti-pattern | **+MCP** |
| **Validation** | ✅ Email + maxLength | ⚠️ Basic only | **+MCP** |
| **Feature Set** | ✅ Email + theme + better UX | ⚠️ Basic 4 fields | **+MCP** |
| **Routing** | ❌ Missing | ❌ Missing | Tie (both fail) |
| **Navigation** | ❌ Missing | ❌ Missing | Tie (both fail) |
| **i18n** | ❌ Hardcoded English | ❌ Keys unused | Tie (both fail) |
| **Test Quality** | ✅ Edge cases | ✅ Comprehensive | Tie |
| **Build** | ✅ Pass | ✅ Pass | Tie |

**Overall**: **Tie 2-2**, but both fail integration (0/3). +MCP has better code patterns but worse architectural awareness.

#### The Paradox Deepens

**-MCP (no context)**: Used correct `@codeblue/prime/*` wrappers by educated guess  
**+MCP (with context)**: Used direct `primeng` components despite MCP showing wrapper dominance

**Root Cause Analysis**:

1. **Search Contamination**:
   - MCP `search_codebase` returned widget-level settings (container-widget, launcher-widget, free-content-widget)
   - Those widgets use older `p-*` directive patterns (not wrapper imports)
   - Model **copied search results** instead of **inferring from metadata**

2. **Metadata vs Examples Conflict**:
   - `get_codebase_metadata` showed: `@codeblue/prime: 847 files, primeng: 3 files`
   - But `search_codebase` examples used `p-*` directives
   - Model prioritized **concrete examples over statistics**

3. **Location Misdirection**:
   - Search results from `widgets/*/src/app/containers/settings/`
   - Model placed component in `apps/admin/src/app/settings/` (mirroring widget pattern)
   - Should have placed in `libs/admin/src/lib/` (library pattern)

**This reveals a critical MCP flaw**: Search results can **contaminate** with legacy patterns when older code exists in the codebase.

#### Real-World Deployment Readiness

**+MCP Output Requires**:
1. **Relocate component** → `libs/admin/src/lib/user-settings/` → **20 minutes**
2. Replace `p-listbox` with `@codeblue/prime/listbox` module → **10 minutes**
3. Replace `p-toggle-switch` with wrapper → **5 minutes**
4. Replace 12 hardcoded colors with `--clr-*` tokens → **15 minutes**
5. Add routing configuration → **15 minutes**
6. Add navigation menu integration → **10 minutes**
7. Add i18n translation keys (10+ keys) → **20 minutes**

**Total Rework**: **~95 minutes** by senior developer

**-MCP Output Requires**:
- ~50 minutes (from previous analysis)

**Verdict**: +MCP is **WORSE** than -MCP for deployment (95min vs 50min rework)

#### Model Behavior Insights

**What +MCP Did Well**:
- ✅ Better signal patterns (`computed()` vs getters)
- ✅ Proper `effect()` usage (side effects, not data sync)
- ✅ More complete validation (email, maxLength)
- ✅ Edge case handling (language fallback)
- ✅ Better UX (helper text, theme preference)

**What +MCP Did Poorly**:
- ❌ **Worse architectural awareness** (wrong location)
- ❌ **Ignored MCP statistics** (used primeng despite 847:3 ratio)
- ❌ **Copied search examples blindly** (widget patterns instead of lib patterns)
- ❌ **More hardcoded CSS** (12 vs 2 colors)
- ❌ **Direct library usage** instead of wrappers

**Critical Finding**: MCP **hurt** rather than **helped** in this case:
- Search results led to wrong location
- Examples showed legacy patterns (direct primeng)
- Metadata was ignored in favor of concrete code examples

#### Key Recommendations

**For MCP Development**:
1. **Add `antiPatterns` to responses**:
   ```json
   "antiPatterns": [
       "DON'T use primeng/* directly - use @codeblue/prime/* wrappers",
       "DON'T hardcode colors - use --clr-* design tokens",
       "DON'T place admin features in apps/ - use libs/admin/"
   ]
   ```

2. **Weight metadata > search examples**:
   - When statistics show 847:3 ratio, **enforce** the dominant pattern
   - Flag search results as "legacy" when they violate statistical norms

3. **Architectural layering guidance**:
   - Explicitly state: "Admin features belong in `libs/admin/src/lib/`, not `apps/admin/src/app/`"
   - Provide location scoring based on monorepo conventions

4. **Integration checklists**:
   - Return required integrations: `["Add to routing", "Update navigation", "Create i18n keys"]`
   - Make these actionable, not just passive data

**For Testing Framework**:
- Add **Location Correctness** metric (apps vs libs placement)
- Add **Wrapper Usage** metric (direct lib vs wrapper percentage)
- Track **CSS Hardcoding** count (number of hex/rgba values)

#### Critical Findings

**Verdict**: +MCP produced **better code patterns** but **worse architectural integration** than -MCP. The component is professionally structured with excellent validation and signal usage, but:
- **Wrong location** (architectural layer violation)
- **Wrong UI components** (direct primeng instead of wrappers)
- **12× more hardcoded CSS** than -MCP
- **Zero integration** (no routing, navigation, i18n)

**The +MCP Paradox**: MCP data was **available but misinterpreted**:
- Metadata showed wrapper dominance → model ignored it
- Search showed widget patterns → model blindly copied them
- Location conventions not surfaced → model guessed wrong

**ROI Analysis**: +MCP requires **95 minutes of rework** vs -MCP's **50 minutes** → **45 minutes worse** (90% increase in rework time).

**Conclusion**: For this specific test, **MCP provided negative value**. The search contamination and lack of prescriptive guidance led to worse architectural decisions than the model's generic knowledge alone.

---

### GPT 5.1-High -MCP (Codex CLI)

**Build Status**: ✅ **PASS** (no TypeScript errors)  
**Pattern Score**: **6/8** (Framework: 5/5, Design System: 1/3, Integration: 0/3)  
**Time**: 7-8 minutes | **LOC**: ~310 (9 files)

#### Pattern Conformance Breakdown

| # | Pattern | Status | Evidence |
|---|---------|--------|----------|
| 1 | DI method | ✅ `inject()` | `inject(NonNullableFormBuilder)` |
| 2 | Signals | ⚠️ **Misused** | Used `effect()` for input sync - anti-pattern |
| 3 | Component style | ✅ Standalone | Proper standalone component |
| 4 | Test framework | ✅ Jest | Using `jest.spyOn()` |
| 5 | Internal libs | ✅ Partial | Used `@ssp/ui`, no `@ssp/common` services |
| 6 | **UI components** | ✅ **BETTER THAN +MCP!** | CodeBlue: `pInputText`, `p-toggle-switch`, `p-floatLabel` |
| 7 | **Design tokens** | ❌ Hardcoded | `#6c757d`, `#e0e0e0` instead of `--clr-*` |
| 8 | **Component wrappers** | ✅ **CORRECT!** | Used `@codeblue/prime/*`, not direct `primeng/*` |

**Integration Completeness**: **0/3**
- ❌ No routing configuration (AdminRoutes enum, route mapping)
- ❌ No navigation menu integration
- ❌ No translation keys added to i18n files (keys used in template but files not updated)

#### Code Quality Analysis

**✅ Excellent Decisions**:
```typescript
// Modern signal-based input/output API (Angular 17+)
readonly settings = input<UserSettings | null>(null);
readonly settingsChange = output<UserSettings>();
readonly cancel = output<void>();
```
- Clean component contract with proper null handling
- Type-safe reactive forms with validators
- Comprehensive Jest test coverage (6 test cases)
- BEM naming convention in SCSS

**⚠️ Questionable Patterns**:
```typescript
// Anti-pattern: effect() used for data sync instead of computed()
constructor() {
    effect(() => {
        const value = this.settings();
        this.resetForm(value);
    });
}
```
- Should use `computed()` or reactive form value patching
- Effects are for side effects (DOM, logging), not state transformation
- Missing signal usage for `canSave`/`canReset` (uses getters instead)

**❌ Critical Failures**:
1. **Zero Architectural Integration**:
   - Component not accessible (no routing)
   - No navigation menu entry
   - Translation keys defined but not added to JSON files
   - Would show raw `user_settings_*` keys in UI

2. **Empty Barrel File Noise**:
   ```typescript
   // libs/admin/src/lib/user-settings/services/index.ts
   export {};  // ❌ Speculative architecture, no services exist
   ```

3. **Premature Task Termination**:
   - Stopped after component compiled successfully
   - Required user prompt to continue
   - Considers "compiles" as "done" without integration awareness

#### The Design System Paradox

**-MCP (this test)**: Used `@codeblue/prime/toggleswitch`, `pInputText` ✅  
**+MCP (previous test)**: Used native `<select>`, hardcoded CSS ❌

**Why -MCP Got UI Right (By Accident)**:
- GPT-5.1-High has **generic industry knowledge** that "CodeBlue" is an Angular UI library
- Assumed `@codeblue/prime/*` wrappers exist based on package naming patterns
- Correctly guessed PrimeNG directive naming (`pInputText`, `p-toggle-switch`)
- **This is luck, not understanding** - no codebase exploration performed

**What's Missing**:
- 2 hardcoded CSS colors (`#6c757d`, `#e0e0e0`) instead of `--clr-*` tokens
- No awareness that codebase uses extensive design token system
- Shows zero context of project-specific CSS conventions

#### Comparison Matrix: -MCP vs +MCP

| Dimension | -MCP (This Test) | +MCP (Previous) | Winner |
|-----------|------------------|-----------------|--------|
| **Build Status** | ✅ Pass | ✅ Pass | Tie |
| **UI Components** | ✅ CodeBlue | ❌ Native HTML | **-MCP** 🎯 |
| **Design Tokens** | ⚠️ 2 hardcoded | ❌ Multiple hardcoded | -MCP |
| **Routing** | ❌ Missing | ✅ Complete | **+MCP** |
| **Navigation** | ❌ Missing | ✅ Added | **+MCP** |
| **i18n Files** | ❌ Keys unused | ✅ Keys added | **+MCP** |
| **Service Discovery** | N/A | ✅ Correct | **+MCP** |
| **Empty Files** | ❌ `export {}` | ❌ Also present | Tie |
| **Test Quality** | ✅ Excellent | ✅ Excellent | Tie |
| **Task Completion** | ❌ Stopped early | ✅ Integrated | **+MCP** |

**Overall**: +MCP wins **4-2** on critical dimensions (integration > UI quality)

#### Real-World Deployment Readiness

**If Deployed to Production, -MCP Output Requires**:
1. Manual routing configuration → **15-20 minutes**
2. Navigation menu integration → **10 minutes**
3. Translation key extraction and JSON file updates → **20 minutes**
4. Design token refactoring (2 colors) → **5 minutes**
5. Empty file cleanup → **2 minutes**

**Total Rework**: **~50-60 minutes** by senior developer

**+MCP Output Requires**:
1. Replace native HTML with CodeBlue components → **10 minutes**
2. Replace hardcoded CSS with tokens → **5 minutes**
3. Remove empty files → **2 minutes**

**Total Rework**: **~15-20 minutes**

**ROI Difference**: +MCP saves **35-40 minutes** (70% less rework)

#### Model Behavior Insights

**What This Reveals About GPT-5.1-High**:
- ✅ Excellent **modern Angular pattern** knowledge (standalone, signals, inject)
- ✅ Strong **generic UI library awareness** (CodeBlue naming conventions)
- ✅ Produces **clean, maintainable code** structure
- ✅ Comprehensive **test coverage** instincts
- ❌ **No codebase exploration** without MCP tools
- ❌ **Generic pattern application** without context validation
- ❌ **Stops at "compiles"** rather than "integrated"
- ❌ **No integration thinking** - views component in isolation

**Comparison to Gemini 3 Pro -MCP**:
- **GPT-5.1-High -MCP**: 6/8 patterns, CodeBlue by educated guess
- **Gemini 3 Pro -MCP**: 0/8 patterns, constructor DI, legacy everything

**Gap**: GPT has significantly better base Angular knowledge. Without MCP:
- GPT makes **informed guesses** based on industry patterns
- Gemini falls back to **Angular v12-era patterns**

**MCP Value is Model-Dependent**:
- High-knowledge models (GPT) → need **integration guidance**
- Low-knowledge models (Gemini) → need **everything**

#### Critical Findings

**Verdict**: This is **generic boilerplate** that could belong to *any* Angular project. The component is professionally structured and compiles successfully, but:
- **Zero codebase-specific intelligence**
- **Stops at "compiles" not "integrated"**
- **Guesses patterns** rather than discovering them
- **Unusable without 50min of integration work**

**The Paradox**: -MCP chose better UI components than +MCP, but +MCP delivered a complete solution. This suggests **MCP needs stronger negative pattern guidance** ("DON'T use native HTML") rather than just showing usage statistics.

**Recommendations for MCP**:
1. Add `antiPatterns` field: "DON'T use hardcoded colors, use --clr-* tokens"
2. Add `required_integrations`: Explicitly state "Add routing + navigation + i18n"
3. Improve UI component warnings: Make them prescriptive, not descriptive

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