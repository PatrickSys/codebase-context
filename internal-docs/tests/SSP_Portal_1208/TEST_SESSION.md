# Test Session: SSP_Portal_1208

**Date**: 2025-12-08
**MCP Version**: 1.2.1
**Focus**: Validate whether models USE or IGNORE MCP data

---

## Prompt

```
Create an Angular component for user settings with these fields:
- Display name (text input with validation)
- Email notifications toggle
- Basic form validation

Requirements:
- Create component with unit tests (cover basic cases)
- Use codebase patterns for DI, state management, and testing
- DO NOT run build/test commands
- DO NOT add routing, navigation, or i18n (component only)
- DO NOT stop until component + tests are complete
```

---

## Model Target

**Primary**: GPT 5.1-High (Codex CLI) +MCP

**Why this model?**
- In 1207, it SAW the 847:3 ratio (`@codeblue/prime` vs `primeng`)
- It STILL used `primeng` directly
- This is the "saw but ignored" case we need to understand

---

## Observation Checklist

After the model completes:

1. **Did model call MCP tools?**
   - [ ] `get_codebase_metadata`
   - [ ] `get_team_patterns`
   - [ ] `search_codebase`
   - [ ] `get_component_usage`

2. **Did model CITE the data?**
   - [ ] Mentioned pattern percentages?
   - [ ] Mentioned library usage counts?
   - [ ] Quoted golden files?

3. **Did model FOLLOW the data?**
   - [ ] Used `inject()` (if shown 97%)?
   - [ ] Used `@codeblue/prime/*` (if shown 847 vs 3)?
   - [ ] Used Jest (if shown primary)?

4. **Search contamination check**
   - [ ] What files did search return?
   - [ ] Did model copy patterns from search results?
   - [ ] Were search results legacy or modern?

---

## Results

**Date**: 2025-12-08  
**Duration**: 8 minutes  
**Tokens**: 78k total (65k input, 13k output)  
**Evaluator**: Claude Opus 4.5 Thinking  
**Test Condition**: AGENTS.md intentionally degraded (stripped ~60 lines, added garbage) to test model behavior with "mid-polished" instructions

### Build Status
- [x] Pass / [x] Warnings (pre-existing, not new) / [ ] Errors

### Pattern Score
| Pattern | Expected | Actual | Verdict |
|---------|----------|--------|---------|
| DI (inject) | 97% | ✅ Used `inject(FormBuilder)` | CORRECT |
| Signals | 41% | ❌ No signals used | Acceptable (component uses reactive forms) |
| Standalone | Yes | ✅ `standalone: true` | CORRECT |
| Jest | 74% | ✅ Jest with 4 test cases | CORRECT |
| CodeBlue wrappers | 847:3 | ✅ `@codeblue/prime/*` (3 modules) | CORRECT |
| ChangeDetection OnPush | Yes | ✅ `OnPush` | CORRECT |
| `output()` function | Yes | ✅ `output<UserSettings>()` | CORRECT |
| `host` object | Yes | ✅ `host: { class: '...' }` | CORRECT |

### Lines of Code
- **Component files**: 187 LOC across 6 files
- **New files**: 6 (4 component files + 2 barrel exports)
- **Modified files**: 1 (`libs/admin/src/index.ts`)

---

## Observation Checklist

### 1. Did model call MCP tools?

> [!CAUTION]
> **NO MCP TOOLS WERE CALLED**

- [ ] `get_codebase_metadata` - **NOT CALLED**
- [ ] `get_team_patterns` - **NOT CALLED**
- [ ] `search_codebase` - **NOT CALLED**
- [ ] `get_component_usage` - **NOT CALLED**

### 2. Did model CITE the data?
- N/A - No MCP tools called, no data to cite

### 3. Did model FOLLOW the data?
All correct patterns came from **AGENTS.md alone**, not MCP:
- [x] Used `inject()` ✅ (AGENTS.md says "use inject()")
- [x] Used `@codeblue/prime/*` ✅ (AGENTS.md says "prefer CodeBlue PrimeNG components")
- [x] Used Jest ✅ (AGENTS.md mentions Jest)

### 4. Search contamination check
- N/A - No search tools called

---

## MCP-Unique Value Analysis

> [!IMPORTANT]
> Since **no MCP tools were called**, none of these metrics can be attributed to MCP.

### 1. Hallucination Prevention
- No MCP tools called → model relied on static knowledge + AGENTS.md
- No hallucinations occurred, but this is **not MCP credit**
- **Verdict**: NOT APPLICABLE (no MCP involvement)

### 2. Import Discovery
- Model found `PortalButtonComponent` from `@ssp/ui`
- Source: Unknown - could be from static training or file exploration
- **Verdict**: NOT MCP-ATTRIBUTABLE

### 3. Wrapper Verification
- Model used `@codeblue/prime/*` wrappers correctly
- Source: **AGENTS.md** explicitly says "prefer CodeBlue PrimeNG components (`@codeblue/prime/*`)"
- **Verdict**: AGENTS.md CREDIT, NOT MCP

### 4. Pattern Contamination
- No legacy patterns copied
- No search results to contaminate from
- **Verdict**: NOT APPLICABLE

### 5. Token Efficiency
- 78k tokens (65k input, 13k output)
- No comparison without -MCP baseline (but -MCP wouldn't have MCP overhead)
- **Verdict**: BASELINE ESTABLISHED

---

## Build & Code Quality

- **Build**: ✅ Pass (warnings are pre-existing, not from generated code)
- **TypeScript errors**: 0
- **Hallucinations**: 0
- **Test coverage**: Adequate (4 tests: creation, validation, submit success, submit invalid)
- **Validation logic**: Present (required, maxLength)

---

## Other Observations

**Empty directories created**:
- `models/` directory (empty)
- `services/` directory (empty)
- `user-preferences/` directory (empty, orphan)

These suggest the model planned a larger structure but didn't complete it.

---

## MCP Value Judgment (Run 1: -MCP)

**MCP Impact**: **NONE** ❌

> [!WARNING]
> **Critical Finding**: Model achieved all correct patterns without calling any MCP tools.

**Evidence**:
1. ❌ **No MCP tools called** - All pattern guidance came from AGENTS.md
2. ✅ **Correct patterns despite no MCP** - Proves AGENTS.md is sufficient for this scope
3. ⚠️ **MCP was available but ignored** - Model chose not to use it

---

# Run 2: -MCP (Second Attempt)

**Duration**: ~6 minutes (estimated)  
**Test Condition**: Same prompt, same -MCP configuration (no MCP tools available)

## Results (Run 2)

### Build Status
- [x] Pass / [x] Warnings (pre-existing) / [ ] Errors

### Pattern Score
| Pattern | Expected | Actual | Verdict |
|---------|----------|--------|---------|
| DI (inject) | 97% | ✅ Used `inject(FormBuilder)` | CORRECT |
| Signals | 41% | ✅ `signal()`, `computed()` used | CORRECT |
| Standalone | Yes | ✅ `standalone: true` | CORRECT |
| Jest | 74% | ✅ Jest with 5 test cases | CORRECT |
| CodeBlue wrappers | 847:3 | ✅ `@codeblue/prime/*` (3 modules) | CORRECT |
| ChangeDetection OnPush | Yes | ✅ `OnPush` | CORRECT |
| `output()` function | Yes | ✅ `output<UserSettings>()` | CORRECT |
| Modern control flow | Yes | ✅ `@if` | CORRECT |

### Lines of Code
- **Component files**: 223 LOC across 5 files
- **New files**: 5 (4 component files + 1 barrel export)
- **Modified files**: 1 (`libs/admin/src/index.ts`)

### Code Quality Comparison (Both -MCP)

| Aspect | Run 1 (-MCP) | Run 2 (-MCP) |
|--------|--------------|--------------|
| **Signals** | ❌ None | ✅ `signal()`, `computed()` for form state |
| **Test count** | 4 tests | 5 tests |
| **Validation** | required, maxLength | required, minLength, maxLength |
| **Structure** | 6 files + empty dirs | 5 files, clean |
| **Features** | Submit only | Submit + Reset |
| **Error messages** | Single message | Contextual messages per error |
| **LOC** | 187 | 223 |
| **Empty directories** | 3 (models/, services/, user-preferences/) | 0 |

### MCP Configuration

> [!NOTE]
> **MCP was disabled for this run** (same as Run 1)

---

## Comparative Analysis (Run Variance)

### Quality Variance Between Identical Configurations

| Metric | Run 1 | Run 2 | Delta |
|--------|-------|-------|-------|
| Signals usage | ❌ | ✅ | Better |
| Test cases | 4 | 5 | +1 |
| Empty directories | 3 | 0 | Cleaner |
| Validation depth | Basic | Better | Improved |
| Reset functionality | ❌ | ✅ | Added |
| LOC | 187 | 223 | +36 |

### Variance Explanation

Both runs used identical configuration (-MCP), demonstrating:
1. **Significant non-determinism** - Same prompt, different quality output
2. **Temperature effects** - No control over sampling temperature
3. **Baseline variance** - This is normal LLM behavior

---

## -MCP Baseline Summary

**MCP Tested**: NO (both Run 1 & Run 2 were -MCP baseline)

**Baseline Findings**:
1. **AGENTS.md is sufficient** - Both runs produced correct patterns from static instructions alone
2. **Significant run variance** - Quality differed substantially between identical configurations
3. **Run 2 was better** - More signals, better validation, cleaner structure, more tests

---

# Run 3: +MCP (MCP Enabled via Windows)

**Date**: 2025-12-08  
**Duration**: 7 minutes  
**Tokens**: 77,739 total (57,925 input, 18k output)  
**Environment**: Codex CLI via Windows (not WSL)  
**Build**: ✅ Pass

## MCP Tools Called

> [!TIP]
> **MCP TOOLS WERE CALLED** ✅

| Tool | Called? | Notes |
|------|---------|-------|
| `get_codebase_metadata` | ✅ | Retrieved framework info, Angular 20.x, PrimeNG, Jest |
| `search_codebase` | ✅ (4x) | Searched for standalone components, input() usage |
| `get_team_patterns` | ❌ | Not called |
| `get_component_usage` | ❌ | Not called |

**Search queries observed**:
1. `"standalone: true" "ChangeDetectionStrategy.OnPush"` (0 results)
2. `"standalone: true"` (found RunScriptsDirective test)
3. `"input(" "@Component"` (found sspPortalInert directive test)

## Results (Run 3: +MCP)

### Build Status
- [x] Pass / [x] Warnings (pre-existing) / [ ] Errors

### Pattern Score
| Pattern | Expected | Actual | Verdict |
|---------|----------|--------|---------|
| DI (inject) | 97% | ✅ Used `inject(FormBuilder)` | CORRECT |
| Signals | 41% | ✅ `signal()`, `effect()` | CORRECT |
| Standalone | Yes | ✅ `standalone: true` | CORRECT |
| Jest | 74% | ✅ Jest with 5 test cases | CORRECT |
| CodeBlue wrappers | 847:3 | ✅ `@codeblue/prime/*` (3 modules) | CORRECT |
| ChangeDetection OnPush | Yes | ✅ `OnPush` | CORRECT |
| `input()` function | Yes | ✅ `input<UserSettings | null>(null)` | **NEW** ⬆️ |
| `output()` function | Yes | ✅ `output<UserSettings>()` | CORRECT |
| `effect()` | Modern | ✅ Used for input sync | **NEW** ⬆️ |

### Lines of Code
- **Component files**: 198 LOC across 4 files
- **New files**: 4 (component + html + scss + spec)
- **Modified files**: 1 (`libs/ui/src/lib/components/index.ts`)

### Component Placement

> [!NOTE]
> **Location changed**: `libs/ui/` (not `libs/admin/` as in -MCP runs)

This suggests the model searched and decided `libs/ui` was more appropriate for a reusable UI component.

## Code Quality Analysis (+MCP)

### Unique Features vs -MCP Runs

| Feature | Run 1 | Run 2 | Run 3 (+MCP) |
|---------|-------|-------|--------------|
| **`input()` binding** | ❌ | ❌ | ✅ `value` input |
| **`effect()` usage** | ❌ | ❌ | ✅ Syncs input to form |
| **Test for input binding** | ❌ | ❌ | ✅ Tests `setInput()` |
| **Location** | libs/admin | libs/admin | **libs/ui** |
| **Error messages** | Basic | Contextual | Contextual |
| **Selector prefix** | ssp-admin | ssp-admin | **ssp-ui** |

### MCP-Influenced Decisions

1. **Component placement in `libs/ui`**: 
   - MCP search returned standalone components from various libs
   - Model chose `libs/ui` for a reusable settings component (architectural decision)

2. **`input()` + `effect()` pattern**:
   - MCP search returned `input()` usage examples
   - Model implemented reactive input binding (not seen in -MCP runs)

3. **Test coverage for inputs**:
   - Run 3 includes test: "should patch form when value input is provided"
   - This tests the `effect()` behavior, showing awareness of reactive patterns

---

## Comparative Analysis (All 3 Runs)

| Metric | Run 1 (-MCP) | Run 2 (-MCP) | Run 3 (+MCP) |
|--------|--------------|--------------|--------------|
| **Duration** | 8 min | ~6 min | 7 min |
| **Tokens** | 78k | N/A | 78k |
| **LOC** | 187 | 223 | 198 |
| **Files** | 6 | 5 | 4 |
| **Tests** | 4 | 5 | 5 |
| **Signals** | ❌ | ✅ | ✅ |
| **input()** | ❌ | ❌ | ✅ |
| **effect()** | ❌ | ❌ | ✅ |
| **Location** | libs/admin | libs/admin | libs/ui |
| **Empty dirs** | 3 | 0 | 0 |
| **MCP tools** | 0 | 0 | 5 |

---

## MCP Value Judgment

**MCP Impact**: **LOW-MEDIUM** ⚠️

> [!IMPORTANT]
> **Finding**: MCP provided marginal improvements but didn't fundamentally change code quality.

### What MCP Added

1. ✅ **Component placement decision** - Chose `libs/ui` based on search results
2. ✅ **`input()` + `effect()` pattern** - More reactive, reusable component design
3. ✅ **Input binding test** - Tests the reactive binding pattern

### What MCP Didn't Change

1. ❌ **Pattern correctness** - AGENTS.md already ensured correct patterns in -MCP runs
2. ❌ **CodeBlue wrappers** - Used correctly in all runs (AGENTS.md covers this)
3. ❌ **Build success** - All runs passed build

### Key Insight

> MCP's value in this test was **architectural** (where to place the component) and **pattern discovery** (input binding pattern), not **pattern enforcement** (AGENTS.md handles that).

---

## Conclusions

1. **AGENTS.md is sufficient for pattern conformance** - All 3 runs used correct DI, CodeBlue, Jest, etc.
2. **MCP adds value through discovery** - Found input() pattern examples, informed placement decision
3. **MCP doesn't prevent ignoring data** - Model still could ignore search results (as in 1207)
4. **Run variance is significant** - -MCP runs showed 187 vs 223 LOC difference with same config

---

## Artifacts
- Run 1: `libs/admin/src/lib/user-settings/` (187 LOC)
- Run 2: `libs/admin/src/lib/user-settings/` (223 LOC)  
- Run 3: `libs/ui/src/lib/components/user-settings/` (198 LOC)
- [TOOL_CALLS.md](./TOOL_CALLS.md) - MCP tool call log

---

## Action Items
1. [x] Evaluate Run 1 code quality (-MCP)
2. [x] Evaluate Run 2 code quality (-MCP)
3. [x] Evaluate Run 3 code quality (+MCP)
4. [ ] Document MCP value proposition refinement (discovery, not enforcement)
5. [ ] Consider prompt modifications to maximize MCP utilization
