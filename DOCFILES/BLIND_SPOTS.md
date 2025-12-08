# MCP Blind Spots & Gaps

**Discovered**: 2025-12-08  
**Trigger**: GPT-5.1-High ±MCP paradox in SSP_Portal_0712 test session  
**Impact**: Critical - Affects MCP effectiveness for UI/design system guidance

---

## Executive Summary

Testing revealed a **critical paradox**: Models WITHOUT MCP correctly used CodeBlue components and design tokens (by accident/generic knowledge) but WITH MCP used native HTML and hardcoded CSS despite MCP surfacing the correct data.

**Root Cause**: MCP excels at **structural intelligence** (services, architecture, patterns) but lacks **visual/design intelligence** (UI components, styling, design tokens).

**Impact on Value Proposition**: 
- ✅ MCP prevents service hallucinations and ensures architectural integration
- ❌ MCP does NOT guide design system usage, which is a critical codebase pattern
- ⚠️ This undermines the claim "MCP prevents vibe coding and pattern drift"

---

## The Paradox (Evidence)

### Test Case: GPT-5.1-High on SSP_Portal

**WITHOUT MCP** (-MCP):
```typescript
// ✅ Used CodeBlue components
<cb-dropdown formControlName="language">
<cb-toggleswitch formControlName="emailNotifications">

// ✅ Used design tokens  
color: var(--cb-text-secondary, #6b7280);

// ❌ But hallucinated services
private readonly toastService = inject(PortalToastService); // doesn't exist in @ssp/ui

// Result: 3 build errors, no routing integration
```

**WITH MCP** (+MCP):
```typescript
// ❌ Used native HTML despite MCP showing CodeBlue usage
<select formControlName="language">

// ❌ Hardcoded CSS despite design token patterns
border: 1px solid #d0d7de;

// ✅ But correct services
private readonly timeZoneService = inject(TimeZoneService);
private readonly translationsService = inject(CommonTranslationsService);

// Result: Compiles, fully integrated, but violates design system
```

### What MCP Surfaced (but model ignored)

```json
{
  "uiLibraries": ["Angular Material", "PrimeNG"],
  "dependencies": [
    { "name": "@codeblue/prime", "version": "^15.0.0", "category": "other" }
  ]
}
```

**The model saw this data but still used native HTML.**

---

## Blind Spot #1: UI Component Inventory ❌

### What's Missing

MCP does not provide:
- Available UI components in the design system
- Component import paths
- Usage frequency of components
- Preferred vs deprecated components

### What Models Need

```json
{
  "uiComponents": {
    "form": {
      "dropdown": {
        "preferred": "@codeblue/prime/dropdown",
        "import": "CodeBlueDropdownModule",
        "usageCount": 47,
        "avoid": ["primeng/dropdown", "native <select>"]
      },
      "toggleSwitch": {
        "preferred": "@codeblue/prime/toggleswitch",
        "import": "CodeBlueToggleSwitchModule", 
        "usageCount": 23,
        "avoid": ["native <input type='checkbox'>"]
      }
    }
  }
}
```

### Current Workaround

Models rely on:
1. Generic LLM knowledge (e.g., "CodeBlue is an Angular UI library")
2. Guessing component names (sometimes correct by accident)
3. Finding components via `search_codebase` (returns old patterns)

### Impact

**High** - Models generate code that compiles but violates design system, creating technical debt.

---

## Blind Spot #2: Design Token Patterns 🎨

### What's Missing

MCP does not track:
- CSS variable usage patterns
- Design token naming conventions
- Preferred vs hardcoded values
- Color/spacing/typography tokens

### What Models Need

```json
{
  "designTokens": {
    "colors": {
      "primary": "var(--cb-primary)",
      "textSecondary": "var(--cb-text-secondary)",
      "frequency": "87%",
      "antiPattern": "#1a73e8 (hardcoded hex)"
    },
    "spacing": {
      "preferred": "var(--cb-spacing-*)",
      "avoid": "hardcoded rem/px values"
    }
  }
}
```

### Current Behavior

`get_team_patterns` returns component-level patterns (inject, signals, standalone) but not styling patterns.

### Impact

**Medium** - Leads to inconsistent styling, harder maintenance, design system drift.

---

## Blind Spot #3: Negative Guidance ("Avoid X") ⛔

### What's Missing

MCP only shows **what exists**, not **what to avoid**:
- No anti-pattern detection
- No deprecation warnings
- No "don't use X, use Y instead" guidance

### Example

**Current MCP output**:
```json
{
  "wrapperRecommendations": [
    {
      "externalLibrary": "primeng",
      "wrapperLibrary": "@company/ui-toolkit",
      "reason": "Wrapper usage: 847, Direct usage: 3"
    }
  ]
}
```

**What's missing**: This shows wrappers exist, but doesn't **prevent** using `primeng` directly during code generation.

### What Models Need

```json
{
  "avoidPatterns": {
    "nativeHTML": {
      "instead": ["<select>", "<input type='checkbox'>"],
      "use": ["cb-dropdown", "cb-toggleswitch"],
      "severity": "high"
    },
    "directPrimeNG": {
      "instead": "primeng/*",
      "use": "@codeblue/prime/*",
      "severity": "critical"
    },
    "hardcodedStyles": {
      "instead": ["#hexcolors", "fixed px values"],
      "use": ["var(--cb-*)", "design tokens"],
      "severity": "medium"
    }
  }
}
```

### Impact

**Critical** - Without negative guidance, models fall back to generic Angular knowledge (native HTML), defeating MCP's purpose.

---

## Blind Spot #4: Golden Files Don't Show UI 👁️

### What's Missing

Current Golden Files show:
- ✅ `inject()` usage
- ✅ `signal()`, `computed()`, `effect()`
- ✅ Standalone component structure
- ❌ **UI component imports**
- ❌ **Template structure**
- ❌ **Styling patterns**

### Example Golden File Output

```typescript
// Current snippet from Golden File
@Component({
  standalone: true,
  imports: [ContainerComponent]
})
export class AppComponent {
  private readonly routerService = inject(RouterService);
  readonly countdown = signal(0);
}
```

**What's missing**: No indication that templates use `<cb-dropdown>` or `<cb-toggleswitch>`.

### What Models Need

Golden Files should include:
```json
{
  "goldenFiles": [
    {
      "file": "user-settings.component.ts",
      "patterns": {
        "inject": true,
        "signals": true,
        "standalone": true,
        "uiComponents": ["cb-dropdown", "cb-toggleswitch"], // NEW
        "designTokens": ["--cb-primary", "--cb-text-secondary"] // NEW
      },
      "templateSnippet": "<cb-dropdown [options]=\"items()\">" // NEW
    }
  ]
}
```

### Impact

**High** - Golden Files are the primary "show by example" mechanism, but they don't show UI/styling patterns.

---

## Blind Spot #5: Search Returns Legacy Patterns 🔍

### The Problem

`search_codebase("user settings")` returns:
- Widget-level settings components (older patterns)
- `sw-*` components (legacy SW library)
- `--sw-grey-*` CSS variables (deprecated tokens)

But NOT:
- Modern admin components
- CodeBlue component usage
- Current design tokens

### Why This Happens

Semantic search finds **similar names** ("settings") but doesn't filter by:
- Recency (newer files preferred)
- Pattern conformance score (modern vs legacy)
- Layer/context (admin vs widget)

### What's Needed

```json
{
  "searchFilters": {
    "preferModern": true,  // Boost high-conformance files
    "layer": "admin",      // Filter by architectural layer
    "excludeLegacy": ["sw-*", "old patterns"]
  }
}
```

### Impact

**Medium** - Models copy legacy patterns when MCP surfaces old examples.

---

## Blind Spot #6: No Component Template Analysis 📄

### What's Missing

MCP indexes TypeScript but doesn't deeply analyze:
- HTML templates
- Component selector usage
- What components are used together
- Template patterns (structural directives, bindings)

### Example

Current: Knows `DropdownComponent` exists  
Missing: Doesn't know it's used via `<cb-dropdown [options]="items()">`

### What's Needed

Track template-level patterns:
```json
{
  "templatePatterns": {
    "cb-dropdown": {
      "usageCount": 47,
      "commonBindings": ["[options]", "formControlName", "[style]"],
      "canonicalExample": "<cb-dropdown [options]=\"items()\" formControlName=\"field\">"
    }
  }
}
```

### Impact

**Medium** - Models don't know **how** to use components even if they know they exist.

---

## Pre-Launch Recommendations

### Critical (Must-Fix Before Launch) 🔴

1. **Add UI Component Inventory Tool**
   - Tool: `get_ui_components({ category?: 'form' | 'data' | 'navigation' })`
   - Returns: Available components, import paths, usage count, examples
   - **Why critical**: Without this, MCP can't guide component selection at all
   - **Effort**: Medium (2-3 days)

2. **Enhance Golden Files with UI Patterns**
   - Include template snippets showing component usage
   - Track which UI components are in high-scoring files
   - **Why critical**: Golden Files are primary guidance mechanism
   - **Effort**: Low (1 day)

3. **Add Negative Guidance to Wrapper Recommendations**
   - Change from "wrapper exists" to "DON'T use X, use Y"
   - Add severity levels (critical, high, medium)
   - **Why critical**: Prevents anti-patterns proactively
   - **Effort**: Low (1 day)

### High Priority (Launch Blockers) 🟠

4. **Design Token Pattern Detection**
   - Add to `get_team_patterns`: CSS variable usage patterns
   - Track `var(--cb-*)` vs hardcoded values
   - **Why important**: Design consistency is critical for enterprise
   - **Effort**: Medium (2 days)

5. **Search Filtering by Modernity**
   - Boost results with high pattern conformance scores
   - Filter by architectural layer (admin vs widget)
   - **Why important**: Prevents copying legacy patterns
   - **Effort**: Medium (2-3 days)

### Medium Priority (Post-Launch) 🟡

6. **Template Pattern Analysis**
   - Parse HTML templates to track component usage patterns
   - Extract canonical binding examples
   - **Why useful**: Shows HOW to use components, not just that they exist
   - **Effort**: High (1 week)

7. **Anti-Pattern Detection Tool**
   - `detect_anti_patterns()` - scans for native HTML, hardcoded CSS, direct lib imports
   - **Why useful**: Reactive validation during code review
   - **Effort**: Medium (3 days)

---

## Alternative: Document the Limitation

If implementing these tools is too costly pre-launch:

### Option: Accept & Document

Add to README/docs:
```markdown
## MCP Limitations

The codebase-context MCP excels at:
- ✅ Service discovery and dependency injection patterns
- ✅ Architectural integration (routing, modules, layers)
- ✅ Framework-level patterns (signals, standalone, testing)

Current limitations:
- ⚠️ Does not guide UI component library selection
- ⚠️ Does not enforce design token usage
- ⚠️ Does not prevent anti-patterns proactively

**Recommendation**: Pair MCP with:
- AGENTS.md guidelines for UI component selection
- Design system documentation in Context7
- Code review for design adherence
```

---

## Impact on Value Proposition

### Current Claims (from SPEC.md)

> "Prevents AI from generating 'vibe code' that works but violates team conventions"

**Status**: ⚠️ **Partially True**
- ✅ Prevents service hallucinations (tested)
- ✅ Ensures architectural integration (tested)
- ❌ Does NOT prevent UI component violations (tested)
- ❌ Does NOT enforce design token usage (tested)

### Revised Positioning

**Before**: MCP prevents all pattern drift  
**After**: MCP prevents **structural** pattern drift (services, architecture) but requires complementary tools for **visual** pattern drift (UI, design system)

### Market Differentiation Still Valid

Competitors (FileScopeMCP, AI Distiller, In Memoria) also don't solve this. But we need to:
1. Be honest about the limitation
2. Provide a roadmap to address it
3. Or position as "architectural intelligence, not design intelligence"

---

## Technical Debt Created

### If We Don't Fix This

Models will continue to:
- Generate native HTML in CodeBlue codebases → **Design system debt**
- Use hardcoded CSS values → **Maintenance debt**
- Mix legacy and modern components → **Migration debt**

**Estimated cost**: 20-30% slower refactoring when cleaning up AI-generated code.

### If We Do Fix This

MCP becomes the **single source of truth** for both:
- Structural patterns (services, DI, architecture) ✅ Already working
- Visual patterns (UI components, design tokens) ❌ Needs implementation

---

## Next Steps

1. **Decide**: Fix pre-launch or document limitation?
2. **If fixing**: Prioritize Critical items (1-3) first
3. **If documenting**: Update SPEC.md, README.md with honest limitations
4. **Either way**: Update testing framework to measure UI/design conformance

---

## Validation Needed

Before considering this "solved", test:
1. Can MCP guide a model to use `cb-dropdown` instead of `<select>`?
2. Can MCP prevent hardcoded CSS in designs?
3. Can MCP suggest design tokens for new components?

**Success criteria**: +MCP test scores higher than -MCP on UI component usage.
