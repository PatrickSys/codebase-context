----------------------------------------
# BLIND_SPOTS
----------------------------------------

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

----------------------------------------
# ISSUES
----------------------------------------

# Known Issues & Technical Debt

This document tracks current issues, their root causes, and proposed solutions.

---

## Issue 1: Log Messages Labeled as `[error]` in IDE

### Symptom
All server logs appear with `[error]` severity in the IDE output panel, even informational messages like:
```
[error] Registered analyzer: angular (priority: 100)
[error] Server ready
[error] Model loaded successfully
```

### Root Cause
The server uses `console.error()` for all logging. This is *partially* correct since stdio MCP servers must reserve `stdout` for JSON-RPC protocol messages. However, the **proper MCP approach** is to use structured logging via `server.sendLoggingMessage()`.

Other MCP servers that display `[INFO]` labels use the MCP SDK's structured logging:
```typescript
// Declare logging capability
const server = new Server({...}, { capabilities: { logging: {} } });

// Use structured logging with severity levels
server.sendLoggingMessage({ level: "info", data: "Server ready" });
```

### Current Code
```typescript
// src/index.ts, src/storage/lancedb.ts, src/embeddings/transformers.ts
console.error("Server ready");  // Always shows as [error]
```

### Proposed Fix
1. Add `logging: {}` to server capabilities
2. Replace all `console.error()` calls with `server.sendLoggingMessage()` using appropriate severity levels:
   - `info`: Normal startup messages, progress updates
   - `warning`: Deprecated features, fallback behavior
   - `error`: Actual errors, failures

### Affected Files
- `src/index.ts` (~30 occurrences)
- `src/storage/lancedb.ts` (~10 occurrences)
- `src/embeddings/transformers.ts` (~6 occurrences)
- `src/core/indexer.ts` (~10 occurrences)
- `src/core/analyzer-registry.ts` (~3 occurrences)

---

## Issue 2: Duplicate Log Lines

### Symptom
Every log message appears twice in the output:
```
Loading embedding model: Xenova/bge-small-en-v1.5
Loading embedding model: Xenova/bge-small-en-v1.5
Model loaded successfully: Xenova/bge-small-en-v1.5
Model loaded successfully: Xenova/bge-small-en-v1.5
```

### Root Cause
The embedding model (`TransformersEmbeddingProvider`) is **not a singleton**. Each `search_codebase` tool call creates a new `CodebaseSearcher`, which initializes a fresh embedding model instance.

The existing `shouldLog` throttling logic (lines 397-404 in `index.ts`) only applies to indexing progress, not to embedding model initialization.

### Why This Happens
1. User calls `search_codebase` → Creates `CodebaseSearcher`
2. `CodebaseSearcher` initializes `TransformersEmbeddingProvider`
3. Provider logs "Loading embedding model..."
4. If multiple searches happen in quick succession, multiple providers log simultaneously
5. Additionally, there may be stream multiplexing in the MCP client that duplicates stderr output

### Proposed Fix
1. **Make embedding provider a singleton** at module level:
   ```typescript
   // src/embeddings/transformers.ts
   let cachedProvider: TransformersEmbeddingProvider | null = null;
   
   export function getEmbeddingProvider(): TransformersEmbeddingProvider {
     if (!cachedProvider) {
       cachedProvider = new TransformersEmbeddingProvider();
     }
     return cachedProvider;
   }
   ```

2. **Or initialize once at server startup** and inject into tools

### Affected Files
- `src/embeddings/transformers.ts`
- `src/core/search.ts`

---

## Issue 3: LanceDB Schema Error (`No vector column found`)

### Symptom
```
Failed to search: [Error: Failed to execute query stream: Schema Error: No vector column found to create index] {
  code: 'GenericFailure'
}
```

Search functionality completely fails, though other tools work normally.

### Root Cause
The LanceDB table at `.codebase-index` exists but has a **stale schema** that doesn't include the `vector` column required for semantic search.

This happens when:
1. Index was created by an older version before embeddings were added
2. Index was created with `skipEmbedding=true`
3. Indexing was interrupted mid-way (wrote metadata but no embeddings)
4. Schema changed across versions without migration

### Why This Is Critical
This breaks the "easy to set up" promise. Users shouldn't need to manually delete index folders when upgrading.

### Current Behavior
- LanceDB opens the existing table (line 42: `this.db.openTable('code_chunks')`)
- No schema validation is performed
- `vectorSearch()` fails because `vector` column doesn't exist

### Proposed Fix Options

| Approach | Effort | Robustness | Recommendation |
|----------|--------|------------|----------------|
| **1. Schema version check** | Low | Good | ✅ Recommended |
| **2. Graceful fallback** | Medium | Best | Consider for Phase 2 |
| **3. Full migration** | High | Overkill | Not needed |

#### Option 1: Schema Version Check (Recommended)
```typescript
// In LanceDBStorageProvider.initialize():
async initialize(storagePath: string): Promise<void> {
  // ... existing code ...
  
  if (tableNames.includes('code_chunks')) {
    this.table = await this.db.openTable('code_chunks');
    
    // Validate schema has vector column
    const schema = await this.table.schema();
    const hasVectorColumn = schema.fields.some(f => f.name === 'vector');
    
    if (!hasVectorColumn) {
      console.error('Detected old index format without embeddings. Rebuilding...');
      await this.db.dropTable('code_chunks');
      this.table = null;
      // Server will trigger re-index on next startup
    } else {
      console.error('Opened existing LanceDB table');
    }
  }
}
```

#### Option 2: Graceful Fallback (Phase 2)
If vector search fails, fall back to keyword-only search. User still gets results, just less relevant.

### Immediate Workaround
Users must manually delete the stale index:
```bash
rm -rf <project-root>/.codebase-index
```
Then restart the MCP server to trigger a fresh index with embeddings.

### Affected Files
- `src/storage/lancedb.ts`

---

## Priority Matrix

| Issue | Severity | Status | Implementation |
|-------|----------|--------|----------------|
| #3 LanceDB Schema | **High** | ✅ Fixed | Schema validation + auto-rebuild |
| #2 Duplicate Logs | Medium | ✅ Fixed | Singleton caching in embeddings/index.ts |
| #1 Log Levels | Low | ✅ Fixed | Added `logging` capability |

---

## Notes

- These issues were discovered during server startup analysis on 2025-12-07
- All fixes implemented and build verified on 2025-12-07
- Startup logs appearing as `[error]` in IDE is expected stdio MCP behavior

----------------------------------------
# LINKEDIN_POST
----------------------------------------

<!-- INTERNAL DOCUMENT - Draft for LinkedIn announcement -->
<!-- Not for public release. Finalize before posting. -->

# LinkedIn Post: codebase-context-mcp Launch

---

## Main Post (Senior Engineer Framing)

AI coding assistants are smart. They know frameworks, patterns, best practices. But they don't know YOUR codebase.

**They don't understand it like a senior engineer who's worked on it for years.**

A senior engineer knows:
- That `@company/ui-components` is the preferred UI library—not third-party alternatives
- That the team migrated from RxJS to Signals (but it's only 64% done)
- Where to look for "how we do things here"
- That you use Jest, not Jasmine

The AI knows none of this. It's perpetually a new hire on their first day.

This isn't a prompt engineering problem. It's a **context engineering** problem. Andrej Karpathy said it directly: "Context engineering is more critical than prompt engineering."

So I built an MCP that provides the structured intelligence a senior engineer has—extracted automatically from the codebase itself:

**1. Internal Library Discovery**
`"@mycompany/ui-toolkit"` → 847 imports. `"primeng"` directly → 12.
Now the AI knows: Use the wrapper.

**2. Pattern Evidence (Not Just Rules)**
"Your team uses `inject()` at 97%. Constructor injection is legacy (3%)."
Not aspirational goals—observed reality.

**3. Golden Files**
One file that demonstrates ALL patterns together: signals, inject, standalone, effect.
The AI mimics THIS, not Stack Overflow.

**4. Testing Framework Detection**
We analyze actual test files, not package.json.
Your tests use Jest mocks. The AI generates Jest syntax.

**5. Wrapper Detection**
"Your team prefers `@mycompany/ui-toolkit` over raw `primeng`—28x usage ratio."
The AI stops suggesting the wrong import.

Kent Beck calls AI assistants "unpredictable genies"—good at adding features, bad at understanding what already exists. Martin Fowler points to MCP as a promising approach for exactly this problem.

We're an MCP. We give AI the senior engineer knowledge it lacks.

https://github.com/PatrickSys/codebase-context-mcp

Runs locally. Works on any JS/TS project. Angular-specialized analysis available. MIT.

---

## Shorter Version

AI coding assistants know frameworks. They don't know YOUR codebase.

They don't know that `@company/ui-components` is your standard UI library. They don't know your team uses Jest, not Jasmine. They don't know you're migrating to Signals.

I built an MCP that provides the structured intelligence a senior engineer has:

• Internal library discovery (847 uses of `@mycompany/ui-toolkit` vs 12 direct `primeng`)
• Pattern evidence with percentages, not just rules
• Golden Files: one file that shows all team patterns together
• Testing framework detection from actual code

The AI stops acting like a new hire. It acts like someone who's worked on the codebase.

https://github.com/PatrickSys/codebase-context-mcp

---

## Key Quotes to Use

**Andrej Karpathy:**
> "Context engineering is more critical than prompt engineering."

**Kent Beck:**
> "AI is good at inhaling (adding features) but struggles with exhaling (refactoring, simplifying)."

**Stack Overflow 2024:**
> 63.3% of developers cite "lack of codebase context" as top AI challenge.

---

## Screenshot/Visual Suggestions

1. **`get_component_usage` output** showing "@mycompany/ui-toolkit" at 847 uses vs "primeng" at 12
2. **`get_team_patterns` output** showing "inject(): 97%", "Signals: 64%"
3. **Golden Files output** with pattern checkmarks: ✓inject ✓signals ✓effect ✓standalone

---

## Business Impact Metrics (2025 Research)

- **Stop "Vibe Coding" Technical Debt**:
  > "Context engineering is about encoding architectural awareness... ensuring every generation aligns with design intent." — *TheNewStack, 2025*
  We replace vague prompts with 97% confidence patterns.

- **Slash Token Costs by 3-5x**:
  > "Tool-augmented iterative reasoning consumes 2-5x more tokens." — *arXiv:2508.11126*
  Our Golden Files provide the *right* context upfront, eliminating the "guess-and-refine" loop.

- **"Verified Context Beats Model Size"**:
  Ram Rai (VP Engineering, Stack Overflow) confirms: small models with precise context outperform large models with generic context.

- **The Real Context Gap**:
  **63.3%** of developers cite "lack of codebase context" as their #1 AI challenge.

## Early Results (Validated December 2025)

- **Pattern Accuracy**: 98% detection of DI patterns (inject vs constructor) - validated on enterprise-portal
- **Testing Precision**: Differentiates Unit (Jest 70%) from E2E (Playwright 6%) automatically
- **Internal Libraries**: Detected @company/utils (145 uses), @company/common (91 uses), @angular/material (74 uses)
- **Golden Files**: main-toolbar.component.ts scored 6/6 patterns
- **Token Reduction**: Pending broader validation (Phase 1.2)

**Technical Stack**:
- Hybrid search (semantic embeddings + keyword via Fuse.js)
- LanceDB for vector storage (zero-config, fully local)
- AST-based pattern detection




-----


## REFINED NARRATIVE (Challenge Incorporated):

I've worked with AI coding assistants since late 2022—GitHub Copilot, Cursor, Claude Code, Gemini CLI. These tools are impressive: they generate boilerplate instantly, know popular frameworks inside-out, and can refactor code in seconds.

But they consistently miss **one critical thing**: the specific patterns and libraries that define YOUR codebase.

**The pattern I kept seeing:**
- AI suggests `import { Button } from 'primeng/button'` when the team uses `@company/ui-toolkit` (a wrapper with 847 uses vs 3 direct primeng imports)
- AI mixes constructor injection and `inject()` function randomly, when the codebase uses `inject()` 97% of the time
- AI generates Jasmine test syntax when the project migrated to Jest (74% of tests)
- AI recommends public OAuth libraries when the team has `@company/auth` (38 internal uses)

Each time, developers have to **correct the AI's suggestions**, introducing:
- **Inefficiency**: Hours spent refactoring AI code to match team conventions
- **Inconsistency**: Different devs following different patterns based on their AI interactions  
- **Technical debt**: Code that "works" but violates established patterns (what TheNewStack calls "vibe coding")
- **Frustration**: Developers lose trust, review every line, or worse—commit without reviewing

**The Research Validated This Was Not Just My Experience:**
- **63.3%** of developers cite "lack of codebase context" as top AI challenge (Stack Overflow 2024)
- GitClear found AI-generated code **doubled code churn** and increased duplicated blocks **8x**
- TheNewStack identified "vibe coding" (code based on loose prompts) as root cause of technical debt tsunami

**The Root Cause:** AI tools lack **organizational intelligence**. They know frameworks, but they don't know that:
- Your team has standardized UI components (evidence: 847 internal uses vs 3 direct third-party uses)
- Your team is migrating from RxJS to Signals (evidence: 64% signals, 32% BehaviorSubject, trending upward)
- Your team uses `inject()` for DI (evidence: 97% frequency vs 3% constructor)
- Your team separates Unit (Jest) and E2E (Playwright) practices (evidence: 74% Jest, detected distinctly from E2E)

**The Solution I Built:**

Codebase-Context-MCP - a Model Context Protocol server that provides **computational pattern analysis** that can't be derived from reading AGENTS.md or tsconfig.json:

1. **Usage Frequency Quantification**: Not "we prefer inject()" but "inject(): 97%, constructor: 3%"
2. **Wrapper Detection**: "@company/ui-toolkit: 847 uses vs primeng: 3 uses" with tsconfig path validation
3. **Golden Files**: Algorithmically selects ONE file demonstrating multiple patterns together (inject + signals + standalone + effect)
4. **Testing Context separation**: Clearly distinguishes Unit (Jest) from E2E (Playwright) patterns
5. **Pattern Evolution Tracking**: Monitors migration trends ("RxJS declining, Signals increasing")

**Early Results:**
- Tested on 611-file enterprise Angular codebase (enterprise-portal)
- Successfully detected: inject 98%, Jest 74%, wrapper patterns, internal libraries
- Preliminary evidence: 67% token reduction across 2 use cases (pending broader validation)

**The Defensible Differentiator:**
- Not competing on generic search (FileScopeMCP does this)
- Not competing on external docs (Context7 does this)
- Competing on: **Framework-specific computational analysis** (Angular v17+ patterns: signals, inject, standalone)

This requires deep domain expertise and can't be replicated by LLMs reading config files.

**What's Next:**
Currently validating across multiple repos, quantifying business value (cost savings, code quality improvement), and documenting the journey from initial idea → research → evidence-based pivot → validated solution.

Because "verified context beats model size" (Ram Rai, VP Platform Engineering). AI doesn't need bigger models—it needs the right intelligence about YOUR codebase.

https://github.com/PatrickSys/codebase-context-mcp

---


**CRITIQUE OF NARRATIVE (Self-Assessment):**

✅ **Strengths**:
- Specific examples with numbers (847 vs 3, 97%, 74%)
- Connects personal experience to research validation
- Acknowledges preliminary status of some claims ("pending broader validation")
- Clear differentiation from competitors
- Evidence-based (cites Stack Overflow, GitClear, TheNewStack)

⚠️ **Potential Issues**:
- 67% token reduction claim still based on limited data (2 use cases) - could weaken credibility if challenged
- "Doubled code churn" quote needs proper citation (GitClear 2024 study)
- Might be too technical for general LinkedIn audience (consider simplified version)
- Doesn't acknowledge blind spots (security, quality degradation issues)

💡 **Improvement Ideas**:
- Add caveat on token reduction: "Early testing shows 67% token reduction (2 use cases, pending validation across 10+)"
- Lead with emotional hook: "I've corrected the same AI mistake 20+ times"
- Add concrete $ savings calculation for business value
- Consider two versions: Technical (current) and Business-focused (ROI-driven)

----------------------------------------
# marketing-assets
----------------------------------------


# Marketing Assets & Validation Report
Generated for: /path/to/enterprise-portal
Date: 2025-12-06T23:43:19.964Z

## 1. get_team_patterns Output (Real Data)

```json
{
  "patterns": {
    "dependencyInjection": {
      "primary": {
        "name": "inject() function",
        "count": 94,
        "frequency": "98%",
        "examples": [
          "core/guards/auth-guard.service.ts"
        ],
        "canonicalExample": {
          "file": "core/guards/auth-guard.service.ts",
          "snippet": "export class AuthGuard {\n    private readonly authService = inject(AuthService);\n    private readonly routerService = inject(RouterService);\n\n    async canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Promise<boolean | UrlTree> {"
        }
      },
      "alternatives": [
        {
          "name": "Constructor injection",
          "count": 2,
          "frequency": "2%"
        }
      ]
    },
    "componentStyle": {
      "primary": {
        "name": "Standalone",
        "count": 59,
        "frequency": "100%",
        "examples": [
          "src/app/app.component.ts"
        ],
        "canonicalExample": {
          "file": "src/app/app.component.ts",
          "snippet": "@Component({\n    standalone: true,\n    selector: 'app-root',\n    templateUrl: './app.component.html',\n    imports: [LauncherComponent],"
        }
      }
    },
    "stateManagement": {
      "primary": {
        "name": "RxJS",
        "count": 53,
        "frequency": "52%",
        "examples": [
          "shared/adapters/widget-details.adapter.ts"
        ],
        "canonicalExample": {
          "file": "shared/adapters/widget-details.adapter.ts",
          "snippet": "import { WidgetManagementService } from '../../widgets-management/services';\nimport { EMPTY, Observable, catchError, tap } from 'rxjs';\n\n@Directive()\nexport abstract class WidgetDetailsAdapter {"
        }
      },
      "alternatives": [
        {
          "name": "Signals",
          "count": 41,
          "frequency": "41%"
        },
        {
          "name": "RxJS Subjects",
          "count": 7,
          "frequency": "7%"
        }
      ]
    },
    "reactivity": {
      "primary": {
        "name": "Effect",
        "count": 14,
        "frequency": "50%",
        "examples": [
          "lib/components/base-element.component.ts"
        ],
        "canonicalExample": {
          "file": "lib/components/base-element.component.ts",
          "snippet": "*/\n    protected readonly languageEffect = effect(() => {\n        const language = this.language();\n        untracked(() => {\n            this.useLanguage(language);"
        }
      },
      "alternatives": [
        {
          "name": "Computed",
          "count": 14,
          "frequency": "50%"
        }
      ]
    },
    "componentInputs": {
      "primary": {
        "name": "Signal-based inputs",
        "count": 28,
        "frequency": "88%",
        "examples": [
          "lib/components/base-element.component.ts"
        ],
        "canonicalExample": {
          "file": "lib/components/base-element.component.ts",
          "snippet": "*/\n    readonly isAdminMode = input(false);\n\n    /**\n     * Whether the widget should show its settings"
        }
      },
      "alternatives": [
        {
          "name": "Decorator-based @Input",
          "count": 4,
          "frequency": "13%"
        }
      ]
    }
  }
}
```

## 2. get_component_usage ("@company/utils")

```json
{
  "source": "@company/utils",
  "count": 87
}
```

## 3. Token Reduction Proxy Test

**Scenario**: Search for "logging utility"

**Without MCP (Standard Search)**:
- Would return generic string matches.
- Estimate: ~10 results * ~500 tokens context + overhead = ~5000+ tokens to verify.

**With MCP (Semantic + Usage)**:
- Tool call: `get_component_usage("@company/utils")`
- Result: Exact usage count and locations.
- Tokens: ~200 (Structured Response).


----------------------------------------
# MOTIVATION
----------------------------------------

# Motivation: Why This Exists

> **TL;DR**: AI coding assistants are smart but generic. They don't know YOUR codebase's patterns, conventions, or context. This MCP gives them that context.

---

## The Problem

### Industry Pain Points

| Pain Point | Evidence |
|------------|----------|
| **"AI doesn't know my codebase"** | 63.3% of developers cite lack of codebase understanding as top AI limitation ([Stack Overflow 2024](https://survey.stackoverflow.co/2024/ai)) |
| **"AI suggests generic patterns"** | AI suggests Material UI when team uses PrimeNG. Suggests constructor injection when team uses inject(). |
| **"Vibe coding" creates churn** | AI-generated code doubled code churn in 2024, 8x increase in duplicated code ([GitClear 2024](https://www.gitclear.com/)), DORA recognizes code churn as negative predictor of defects ([State of DevOps 2024](https://dora.dev/research/2024/dora-report/)) |
| **Time spent correcting AI** | Developers repeatedly correct same patterns: "use inject()", "use our wrapper", "write tests like we do" |

### What Existing Tools Don't Solve

| Tool Category | What They Do | The Gap |
|---------------|--------------|---------|
| **AGENTS.md, .cursorrules, CLAUDE.md** | Static instructions (what team WANTS) | Can't quantify actual usage (what team DOES) |
| **Context7** | External library docs | Not YOUR internal patterns |
| **GitHub Copilot @workspace** | Runtime search | No pre-indexed pattern awareness |
| **Cursor embeddings** | Pre-indexed search | Framework-agnostic, no pattern detection |

---

## Our Solution

### What We Provide

| Feature | Why It Matters |
|---------|----------------|
| **Pattern Frequency Detection** | "97% use inject(), 3% constructor" - AI knows the consensus |
| **Internal Library Discovery** | "Use @company/ui-toolkit not primeng directly" - wrapper detection |
| **Golden Files** | Real examples showing patterns in context, not isolated snippets |
| **Testing Framework Detection** | "Write Jest tests, not Jasmine" - detected from actual spec files |

### Complementary Positioning

> **AGENTS.md tells AI what team WANTS. We show what they DO.**

Combined: AI sees both intention (AGENTS.md) AND reality (pattern data). Can identify gaps.

---

## Known Limitations

We're honest about what we don't solve:

| Limitation | Status |
|------------|--------|
| **Pattern frequency ≠ pattern quality** | 97% usage could be technical debt. We show consensus, not correctness. |
| **Stale index risk** | Manual re-indexing required. Lazy indexing planned (Phase 1.6). |
| **Framework coverage** | Angular-specialized now. React/Vue analyzers extensible. |
| **LLM context placement** | We provide structured data. How the AI uses it depends on the client (Cursor, Claude, etc.). |

---

## Key Learnings (From Building This)

1. **Statistical detection isn't enough** - Saying "97% use inject()" is useless if AI doesn't see HOW to use it. Golden Files with real examples solved this.

2. **Complementary, not replacement** - We work WITH AGENTS.md, not against it. Different layers of context.

3. **Simplicity beats completeness** - Dropped features that added complexity without clear value (dependency graphs, violation detection). Focus on core patterns.

4. **Human-led, not autonomous** - Research shows autonomous agents have ~30-35% success rate on multi-step tasks ([Thoughtworks Technology Radar](https://www.thoughtworks.com/radar), arXiv papers). We optimize for human+AI collaboration.

---

## Sources

### Industry Research

1. [Stack Overflow 2024 Developer Survey - AI Section](https://survey.stackoverflow.co/2024/ai) - 65,000+ respondents
2. [GitClear 2024 AI Code Quality Report](https://www.gitclear.com/) - Code churn analysis
3. [DORA State of DevOps 2024](https://dora.dev/research/2024/dora-report/) - Code churn as quality metric
4. [Anthropic MCP](https://modelcontextprotocol.io/) - Protocol specification

### Academic Papers (arxiv)

5. [Grounded AI for Code Review](https://arxiv.org/abs/2510.10290) - "Every AI-generated comment must be anchored to deterministic signals"
6. [Code Digital Twin](https://arxiv.org/abs/2503.07967) - "Tacit knowledge is embedded in developer experience, not code"
7. [CACE: Context-Aware Eviction](https://arxiv.org/abs/2506.18796) - Multi-factor file scoring for context efficiency

### Internal Validation

8. Enterprise Angular codebase (611 files): inject 98%, Jest 74%, wrapper detection working

---

*Last updated: December 2025*


----------------------------------------
# README
----------------------------------------

# codebase-context-mcp

**The "missing cortex" for AI coding agents.** Internal library discovery, wrapper detection, and evidence-backed patterns—the context that `AGENTS.md` can't provide.

---

## The Problem

AI coding assistants (Copilot, Cursor, Claude) can generate instruction files (`AGENTS.md`, `.cursorrules`). They analyze your code and extract conventions. Impressive.

**But they can't tell the AI about your internal libraries.**

Your team wraps Material with `@company/ui-components`. You have utilities at `@company/utils`. The AI has no way to know these exist—they're not in any Angular doc or Stack Overflow answer. So it suggests `@angular/material/button` when it should suggest `@company/ui-components/button`.

That's the gap we fill.

---

## What We Provide

### 1. Internal Library Discovery

Other tools find where things are **defined**. We find where things are **used**.

```bash
get_component_usage("@mycompany/ui-toolkit")
# → "usageCount": 847, "usedIn": [...]
```

The AI now knows: this library exists and is heavily used. Combined with tsconfig paths (which we also expose), the AI can infer it's internal.

### 2. Wrapper Detection (AI-Inferred)

We expose raw usage data that lets the AI infer wrapper relationships:

```json
{
  "topUsed": [
    { "source": "@mycompany/ui-toolkit", "count": 847 },
    { "source": "primeng", "count": 3 }
  ],
  "tsconfigPaths": {
    "@mycompany/*": ["libs/*"]
  }
}
```

The AI sees: `@mycompany/ui-toolkit` is used 847x vs `primeng` at 3x, and `@mycompany/*` maps to local code. It infers `@mycompany/ui-toolkit` is the preferred wrapper.

### 3. Golden Files (Context Window Efficiency)

Instead of the AI doing multiple searches—"find inject usage... find signals... find standalone..."—we provide ONE file that demonstrates all patterns together.

```json
{
  "file": "settings.component.ts",
  "score": 5,
  "patterns": { "inject": true, "signals": true, "effect": true, "standalone": true }
}
```

One file. All patterns. Minimal tokens. No Frankenstein code.

### 4. Testing Framework Detection

We detect your actual testing stack from code patterns, not just `package.json`:

```json
{
  "testingFramework": { "primary": "Jest", "frequency": "100%" },
  "testMocking": { "primary": "Jest mocks", "frequency": "87%" }
}
```

No more Jasmine syntax in a Jest project.

---

## Relationship with AGENTS.md

| | AGENTS.md | codebase-context-mcp |
|---|---|---|
| **Provides** | What team *wants* (guidance) | What team *does* (evidence) |
| **Internal libraries** | ❌ Can't discover | ✅ Tracks usage counts |
| **Canonical examples** | ❌ Describes rules | ✅ Finds real implementations |
| **Format** | Prose | Structured JSON |

**They're complementary. Use both.**

AGENTS.md tells the AI what you *want*. We show what you *actually do*—and surface the internal libraries and examples that no doc can provide.

---

## Tools

| Tool | What It Does |
|------|--------------|
| **`get_component_usage`** | Find WHERE a library/component is used ("Find Usages") |
| **`get_team_patterns`** | Pattern frequencies + canonical examples + golden files |
| `search_codebase` | Semantic + keyword hybrid search |
| `get_codebase_metadata` | Project structure + patterns summary |
| `get_style_guide` | Style guide content lookup |
| `get_indexing_status` | Index state and progress |
| `refresh_index` | Re-index the codebase (supports `incrementalOnly: true` for Phase 2) |



---

## Architecture

```
┌───────────────────────────────────────────────────────┐
│            codebase-context-mcp (Core)                │
│  • Hybrid search (semantic + keyword)                 │
│  • Import graph (who uses what)                       │
│  • tsconfig paths extraction                          │
│  • Golden file discovery                              │
└──────────────────────────┬────────────────────────────┘
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
 Angular Analyzer    [Future: React]    Generic Analyzer
 (DI patterns,        (hooks, state,   (TS/JS fallback)
  Signals, etc.)       components)
```

**Pluggable analyzer architecture** with a generic base:

- **Generic Analyzer**: Handles any JS/TS project (import graph, patterns, usage tracking). For other languages (Python, Go, Rust), basic chunking works but deep pattern detection requires dedicated analyzers.
- **Angular Analyzer**: Specialized patterns (inject, signals, standalone, etc.)
- **Future**: React, Vue analyzers planned; tree-sitter integration for true multi-language AST support.

> **Current focus**: JS/TS codebases with Angular as the primary specialized analyzer. The architecture is designed to be language-agnostic with pluggable analyzers—that's the mid-term vision.

---

## Setup

### Install from npm

```bash
npm install -g codebase-context-mcp
```

Or use with npx (no install needed):

```bash
npx codebase-context-mcp /path/to/your/project
```

### Configure in your MCP client (e.g., Claude Desktop)

```json
{
  "codebase-context-mcp": {
    "command": "npx",
    "args": ["codebase-context-mcp", "/path/to/your/project"]
  }
}
```

Or if installed globally:

```json
{
  "codebase-context-mcp": {
    "command": "codebase-context",
    "args": ["/path/to/your/project"],
    "env": {
      "EMBEDDING_PROVIDER": "openai",
      "OPENAI_API_KEY": "sk-..."
    }
  }
}
```

### Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `EMBEDDING_PROVIDER` | `transformers` | Set to `openai` to use OpenAI's API (faster, lighter) or `transformers` for local (private, free). |
| `OPENAI_API_KEY` | - | Required if provider is `openai`. |

**Why use OpenAI?**
- **Faster**: No need to download/run local 100MB+ models.
- **Lighter**: Significantly less RAM usage for the MCP server.
- **Cost**: `text-embedding-3-small` is extremely cheap ($0.02 per 1M tokens), but technically not free like local.

---

## What We Don't Do

We stay focused. Here's what we deliberately exclude:

| Feature | Why Not | Who Does It |
|---------|---------|-------------|
| Infer "preferred" vs "legacy" | Requires team input | Your AGENTS.md |
| Cross-repo context | Scope creep | Sequa |
| Code violation detection | Different niche | ESLint, CodeScene |
| External library docs | Different problem | Context7 |

---

## Known Limitations

| Limitation | Status | What to do about it |
|------------|--------|---------------------|
| **Deep patterns are JS/TS only** | MVP | Generic analyzer handles any language for search/chunking, but real AST-based pattern detection uses TypeScript parser. Tree-sitter integration planned for multi-language support. |
| **Specialized patterns are Angular-only** | MVP | React/Vue specialists are planned. The pluggable architecture makes this extensible. |
| **Single repo** | MVP | Multi-repo (Nx workspaces) planned. For now, point it at one repo at a time. |
| **Pattern frequency ≠ correctness** | By design | We show team consensus, not "right" patterns. 97% inject() usage doesn't mean inject() is correct—it means that's what your team does. Combine with AGENTS.md for intent. |
| **Index goes stale** | MVP | Re-index manually with `refresh_index` or restart the MCP. Incremental indexing planned for Phase 2. |
| **First index can be slow** | Depends | Uses local embeddings by default (downloads ~100MB model). Use `EMBEDDING_PROVIDER=openai` for faster startup if privacy isn't a concern. |


---

## Why This Exists

📄 **[Motivation](./MOTIVATION.md)** - The research and pain points that led to this

## License

MIT

----------------------------------------
# SITUATION_ANALYSIS
----------------------------------------

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

----------------------------------------
# SPEC
----------------------------------------

<!-- INTERNAL DOCUMENT - Strategic vision and roadmap -->
<!-- Not for public release. See README.md for external documentation. -->


### TODO PENDING TO ANALYZE AND ASSESS IF FITS INTO SCOPE:
 USE VECTOR COSINE COMPARISON FOR AGGREGATED RERANKING? https://medium.com/@nisarg.nargund/introducing-metarag-a-new-era-of-multi-llm-retrieval-augmented-generation-26c5cd0c5a60 
---https://arxiv.org/abs/2509.09360
-- MAYBE USE CODEGEN SCORER https://github.com/angular/web-codegen-scorer?tab=readme-ov-file

# SPEC.md - Codebase-Context MCP

**Purpose**: Vision, positioning, and implementation roadmap.  
**Last Updated**: December 2025

---

## Vision: The Journey from Idea to Validated Solution

> **Intelligence Layer for Human-Led AI Development**
>
> We provide the **structured codebase intelligence** that enables AI assistants (Cursor, Copilot, Claude) to understand YOUR specific codebase patterns - not just generic framework knowledge. The human owns the thinking and design, while AI assists with implementation using evidence-based context.

### The Origin: A Persistent Pain Point (Late 2022-2024)

Working with AI coding assistants since early GitHub Copilot, a consistent pattern emerged: these tools excel at generic tasks but **lack deep understanding of specific codebases**. They suggest third-party libraries when internal wrappers exist, mix DI patterns inconsistently, and generate "vibe code" that works but violates team conventions.

**The realization**: This isn't a prompt engineering problem - it's a **context engineering** problem.

###

The Evolution from Initial MCP to Research-Backed Solution

**Month 1: Initial Implementation** - Built basic semantic search MCP "because it sounded like a nice idea"
- Simple codebase indexing and search
- No framework-specific knowledge
- Generic embeddings approach

**Month 2-3: Reality Check** - Discovered the limitations
- Semantic search returned too many irrelevant results
- No way to distinguish internal libraries from external ones
- Couldn't quantify team patterns ("we prefer X" vs "97% use X")

**Month 4-6: Deep Research** - Investigated real-world pain points
- Analyzed 15+ research papers, 9 industry sources, 3 developer surveys
- Identified THE problem: "63.3% cite lack of codebase context" (Stack Overflow 2024)
- Discovered "vibe coding" and technical debt accumulation (TheNewStack, GitClear)
- Found evidence: token costs 2-5x higher with iterative refinement (arXiv)
- Learned: Autonomous agents fail 65-85% of the time, human-in-the-loop succeeds (Thoughtworks, GitHub, CMU)

**Month 7-8: Strategic Pivot** - Rebuilt with evidence-based features
- Added Golden Files (algorithmic scoring for best examples)
- Added pattern frequency tracking (97% inject, not just "prefer inject")
- Added wrapper detection (@company/ui: 847 uses vs primeng: 3 uses)
- Added testing framework detection from actual code (not package.json)
- Focused on framework-specific depth (Angular v17+ signals, inject, standalone)

**Month 9: Competitive Differentiation** - Defined the defensible moat
- Not competing on: General codebase search (FileScopeMCP does this)
- Not competing on: External docs (Context7 does this)
- Competing on: **Framework-specific computational pattern analysis**
  - Requires deep domain expertise (Angular v17+ patterns)
  - Cannot be replicated by reading config files
  - Updates dynamically as codebase evolves

**Current: Validation Phase** - Proving the value
- Tested on enterprise-portal (611 files): inject 98%, Jest 74%, identified wrappers
- Preliminary evidence: 67% token reduction across 2 use cases
- Pending: Validation across 10+ use cases, external repos, business value quantification

### What We Provide (Honest Assessment)

| Capability | Value | Rationale |
|------------|-------|-----------|
| **Internal Library Discovery** | **UNIQUE** | Enables Agents to use `@mycompany/utils` instead of reinventing wheels. |
| **Wrapper Detection & Warnings** | **UNIQUE** | Prevents Agents from importing `primeng` when `@mycompany/ui-toolkit` is required. |
| **Context-Efficient Golden Files** | **UNIQUE** | Feeds Agents the *perfect* few-shot example to mimic style, minimizing token cost. |
| **Testing Framework Detection** | **UNIQUE** | Prevents Agents from generating Jasmine syntax in Jest projects. |
| **Evidence for Guidance** | **SUPPORTING** | Grounding data to prevent hallucinations. |

### Design Principle: Context Window Efficiency

> **"Agentic AI multi-step planning has ~30-35% success rate. Errors compound."**

Bad context -> Bad Plan -> Failed Task. Our MCP prioritizes:
- **Quality over quantity** — Accurate snippets, not random first-matches
- **One lookup** — Golden Files provide complete examples in single request
- **Actionable warnings** — "Use wrapper X instead of Y" is immediately usable

**Our Positioning:**
> "AGENTS.md tells the Agent what to do. Codebase-Context MCP gives the Agent the **eyes** to see how to do it correctly in *this specific* codebase."

---

## Critical Finding: The Market Is FRAGMENTED

> **No universal standard for AI context. Each major player has their OWN format.**

| Tool | Format | Reach |
|------|--------|-------|
| GitHub Copilot | `.github/copilot-instructions.md` | 1.8M+ paid |
| Cursor | `.cursorrules` | 35.9k stars, 65.9k members |
| Anthropic | `CLAUDE.md` | 44.7k stars |
| Windsurf | `.windsurf/rules/` | Growing |
| Aider | `CONVENTIONS.md` | Established |
| OpenAI | `AGENTS.md` | 8.8k stars (0.0047% repos) |
+ **Gemini/Claude** | **MCP (Tool Usage)** | **The Future of Agentic AI** |

**Our advantage**: Format-agnostic. We don't just "instruct" the Agent; we **empower** it with tools to look around.

---

## Competitive MCP Landscape

| MCP Tool | What It Does | Our Differentiator |
|----------|--------------|-------------------|
| **FileScopeMCP** | Dependency graphs, importance scores | We track internal library usage |
| **AI Distiller** | 90-98% code compression | We preserve patterns, not just APIs |
| **In Memoria** | Persistent patterns, AST parsing | We're framework-specific (Angular) |
| **Sequa** | Cross-repo context | We're single-repo focused |

### Our Unique Value

| Feature | Others | Us |
|---------|--------|-----|
| Internal library tracking | ❌ None | ✅ "@mycompany/utils used in 218 files" |
| Wrapper detection | ❌ None | ✅ "Use @mycompany/ui-toolkit not primeng" |
| Framework-specific | ❌ Generic | ✅ Angular v17+ (signals, inject) |
| Architectural layers | ❌ None | ✅ presentation/business/data/core |
| Testing framework detection | ❌ None | ✅ Jest vs Jasmine/Karma from code |

---

## Current Tools

| Tool | Status |
|------|--------|
| `search_codebase` | ✅ Working |
| `get_team_patterns` | ✅ Working |
| `get_component_usage` | ✅ Working |
| `get_codebase_metadata` | ✅ Working |
| `get_style_guide` | ✅ Working |

---

## Roadmap

### Phase 1.5: Quality Improvements ✅ DONE
- [x] Golden File scoring (find best example files)
- [x] componentStyle snippet extraction
- [x] Wrapper detection & recommendations
- [x] Context window efficiency improvements
- [x] Testing framework detection (Jest/Jasmine/Vitest/Cypress/Playwright)

### Phase 1.6: API Surface ✅ DONE
- [x] Surface `goldenFiles` in `get_team_patterns` response
- [x] Surface `wrapperRecommendations` in `get_team_patterns` response
- [x] Remove `get_analyzer_info` (no user value, context window waste)

### Phase 1.7: Extended Tools (Pre-Launch) 🟡 IN PROGRESS

Items validated from competitive research (see `research/02-competitive-validation.md`):

| Feature | Source | Priority | Status |
|---------|--------|----------|--------|
| File system watcher for auto-updates | code-graph-mcp | 🔴 High | ❌ Removed (see note) |
| `check_import` tool for real-time wrapper validation | Original | 🟡 Medium | ⏳ |
| `refresh_recent_files` tool for quick updates | Original | 🟡 Medium | ⏳ |
| Performance tier documentation (Fast/Moderate/Expensive) | code-graph-mcp | 🟢 Low | ⏳ |
| **External repo validation** (angular-spotify, ever-gauzy) | Public evidence | 🟡 Medium | ⏳ |
| **Token reduction quantification** (broader validation) | Credibility | 🟡 Medium |
| **LinkedIn Post** (publish and light read) | Visibility | 🟢 Low | ⏳ |

> **❌ File Watcher Removed (v1.2.1)**: Feature was implemented but caused infinite re-indexing loops. Without incremental indexing, a single file change triggered a full 7-minute re-index of the entire codebase. The feature was completely removed (not just disabled). Will be reconsidered in Phase 2 when incremental indexing is implemented.

### Phase 2: Infrastructure & Scale (Post-Launch)

| Feature | Source | Priority |
|---------|--------|----------|
| **Incremental indexing** (Merkle trees) | claude-context | 🔴 High |
| **DOUBLE CHECK: Tree-sitter integration** | Multi-language AST support | 🔴 High |
| **Multi-repo support** (Nx workspaces) | Qodo | 🟡 Medium |
| **Impact analysis** ("what would break?") | Qodo | 🟡 Medium |
| React/Vue analyzers (hooks, composition API) | Market demand | 🟡 Medium |
| **LinkedIn Article** (deep dive journey) | Marketing | 🟢 Low |

#### UX/Labeling Improvements (validated Dec 2025)

| Fix | Rationale | Priority |
|-----|-----------|----------|
| Rename `get_component_usage` → `find_import_usage` | Name implies component/class lookup, but tool searches import paths | 🟡 Medium |
| Separate `testRunner` vs `testUtilities` in data model | Jest (runner) and TestBed (utility) are complementary, not competing | 🟡 Medium |
| Add "complementary" flag for RxJS/Signals | Both coexist in modern Angular; current output implies migration | 🟢 Low |

### Phase 3: Code Health & Pattern Governance

**Motivation**: TheNewStack research identifies "vibe coding" (code that works but violates patterns) as causing technical debt. We prevent this.

| Feature | Description |
|---------|-------------|
| **`detect_anti_patterns`** | Flag constructor in 97% inject() codebase, direct primeng when wrapper exists |
| **`code_health_score`** | Pattern conformance score per file (0-100), complexity hotspots |
| **`pattern_drift_tracking`** | Track frequency over time ("inject 60% → 97%"), alert on regression |
| **Multi-step research agent** | Complex queries like "what would break if we refactor?" (from Qodo) |
| **Call graph analysis** | Callers/callees for enhanced impact analysis (from code-graph-mcp) |
| **VSCode extension** | For broader adoption (from claude-context) |

**Business Value**: Position as "governance layer" preventing AI from amplifying technical debt

---

## Architecture

```
Core (Framework-Agnostic)
├── Indexer → .codebase-intelligence.json
├── PatternDetector → patterns + canonical examples + golden files
├── ImportGraph → usage tracking with line numbers
└── LibraryUsageTracker → counts internal library imports

Angular Analyzer (Our Strength)
├── inject() vs constructor detection
├── Signals vs RxJS detection  
├── Component/Service/Directive classification
└── Canonical example selection
```

---

## Testing & Validation

> MCP effectiveness varies by model. See `tests/TESTING_FRAMEWORK.md` for evaluation methodology and `tests/TEST_RESULTS_SUMMARY.md` for findings.

### MCP Improvement Roadmap

Based on validation testing (Dec 2025):

| Issue | Priority | Solution |
|-------|----------|----------|
| **Module existence validation** | 🔴 High | Add `check_import` tool to validate imports against package.json | NOTE: DOUBLE CHECK THIS BECAUSE IMPORTS MIGHT BE FROM SUBMODULE E.G. @CODEBLUE/PRIME MIGHT HAVE PRIME/BUTTON SUBMODULE BUT NOT PRIME/DROPDOWN (IS SELECT)
| **Negative pattern examples** | 🔴 High | Add `antiPatterns` field: "Don't use: Jasmine APIs, constructor DI" |
| **Icon library detection** | 🟡 Medium | Track icon imports in usage-tracker |
| **Complementary labeling** | ✅ Fixed | Renamed "alternatives" → "alsoDetected" |

---

## Success Criteria: Human-Led AI Development

**Primary Use Case**: The **human developer** uses AI assistant (Cursor, Copilot, Claude) WITH MCP context:

1.  ✅ **Spec-Driven Development**: Developer writes spec/requirements, AI generates implementation WITH pattern context
   - Human: "Create user profile component with signals and inject"
   - MCP provides: Golden File showing signals+inject pattern together
   - AI generates: Code matching team's actual patterns (not generic examples)

2.  ✅ **Onboarding Acceleration**: Junior developer exploring unfamiliar codebase
   - Developer: "How does auth work here?"
   - MCP reveals: `@mycompany/auth` usage (38 imports), OAuth library patterns
   - Result: Developer learns internal libraries faster than reading docs

3.  ✅ **Pattern Consistency**: Developer reviewing AI-generated code
   - AI suggests: Constructor injection
   - MCP shows: "inject() used 97%, constructor is legacy (3%)"
   - Developer corrects: Uses inject() instead, maintains consistency

4.  ✅ **Wrapper Discovery**: Developer needs UI component
   - AI suggests: `import { Button } from 'primeng/button'`
   - MCP warns: "@company/ui-toolkit: 847 uses vs primeng: 3 uses"
   - Developer corrects: Uses wrapper, follows team convention

5.  ✅ **Testing Alignment**: Developer writing tests
   - AI generates: Jasmine syntax
   - MCP shows: `testingFramework: Jest (74%)`
   - Developer corrects: Uses Jest syntax, matches team tooling

**Secondary Use Case**: Supervised agentic modes (Cursor Composer, Windsurf) WITH human oversight can query MCP for pattern guidance during multi-file edits.

---

## Sources

**Research Documents** (in `/research`):
- `01-market-research.md` — Market fragmentation, format wars (AGENTS.md vs CLAUDE.md vs .cursorrules)
- `02-competitive-validation.md` — Competitive landscape & independent validation
- `03-senior-engineer-gap.md` — Core value proposition, tacit knowledge, industry quotes
- `04-stress-test-results.md` — Real validation on enterprise-portal, gaps identified
- `docs/RESEARCH_NOTES.md` — Architectural decisions backed by research

**References**:
- Stack Overflow 2024: 63.3% cite "lack of codebase context"
- GitClear 2024: AI-generated code doubled code churn
- Thoughtworks Technology Radar: 14-month tracking of agentic AI failures
- Context7: External docs (complementary)

---

*Internal document. Ready for implementation.*


----------------------------------------
# TEST_RESULTS_SUMMARY
----------------------------------------

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

----------------------------------------
# TEST_RESULTS
----------------------------------------

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

----------------------------------------
# TEST_SESSION_TEMPLATE
----------------------------------------

# Test Session Template

Copy this folder for new test sessions.

## Naming

`[Repo]_MMDD` (e.g., `SSP_Portal_0712`)

## TEST_RESULTS.md (Required)

```markdown
# Test Results: [Repo] - [Feature]

**Date**: YYYY-MM-DD  
**MCP Version**: X.X.X  
**IDE**: [Cursor/VS Code] X.X.X

## Tests

| Model | Version | MCP | Build | Patterns | Tokens | Time | LOC | Notes | Failure |
|-------|---------|-----|-------|----------|--------|------|-----|-------|---------|
| [Model] | [ver] | ✅/❌ | ✅/❌ | X/5 | XXK | Xm | ~XXX | [observations] | [type] |

## Pattern Checklist

### [Model] +MCP

- [ ] inject()
- [ ] signals
- [ ] standalone
- [ ] test framework
- [ ] internal libs

**Failures**: [Hallucination/Ignored/Incomplete/Type error] - [details]

### [Model] -MCP

[Same structure]

## Summary

[What difference did MCP make?]
```

## TOOL_CALLS.md (If MCP enabled)

Copy MCP tool invocations and responses.

## Optional

Screenshots in `images/` for notable issues.

----------------------------------------
# TESTING_FRAMEWORK
----------------------------------------

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

----------------------------------------
# TODO
----------------------------------------

# Launch Checklist

**Goal**: Credible first impression. Ship with validated evidence.

---

## Phase 0: Critical Pre-Release Fix

> **Issue validated December 7, 2025**: The word `"alternatives"` in `get_team_patterns` output implies competition between complementary tools (e.g., Jest vs TestBed). This risks agents skipping TestBed setup in Angular tests.

- [x] **0.1 Rename "alternatives" → "alsoDetected"** in pattern output ✅ Done Dec 7, 2025
  - File: `src/tools/pattern-tools.ts` (or wherever patterns are formatted)
  - Impact: Neutralizes semantic risk in testing scenario
  - Time: ~5 minutes

**Evidence**: See `internal-docs/ISSUES.md` for full validation.

---

## Phase A: Deploy & Verify

- [ ] **A1. npm login** - Required before publishing
- [ ] **A2. Build fresh** (`npm run build`)
- [ ] **A3. Test local execution** (`node dist/index.js "C:\path\to\project"`)
- [ ] **A4. Publish to npm** (`npm publish`)
- [ ] **A5. Test npx install** (`npx codebase-context-mcp "C:\path\to\project"`)

---

## Phase B: Validate with Evidence

### B1. SSP_Portal Validation (Internal)

- [ ] **B1.1 Run MCP** on SSP_Portal
- [ ] **B1.2 Capture outputs** for screenshots:
  - `get_team_patterns` → DI patterns, testing framework, signals
  - `get_component_usage("@company/...")` → internal libraries
  - Note: AGENTS.md is present → claim "MCP complements AGENTS.md"
  - Important! See visual UI output!!
- [ ] **B1.3 Model Tests** (see `tests/TESTING_FRAMEWORK.md` for details):
  
  **Test Features**: User settings component, dashboard widget
  
  | Model | Environment | MCP Tests |
  |-------|-------------|-----------|
  | Codex Mini High | Cursor | ±MCP |
  | Claude Haiku 4.5 | VS Code (sequential-thinking) | ±MCP |
  | Gemini 3 Pro | Gemini CLI | ±MCP |
  
  **Metrics**: Build, Pattern Score (5-point), Tokens, LOC
  
  **Required Documentation per Test**:
  - [ ] Token count
  - [ ] Files generated + LOC
  - [ ] Compilation status (✅/❌)
  - [ ] Testing framework used (Jest/Jasmine/None)
  - [ ] Pattern conformance (inject/signals/standalone)
  - [ ] UI library usage (CodeBlue/PrimeNG/native)
  - [ ] i18n integration (yes/no)
  - [ ] Invented modules/APIs (list any)
  
  **Save Results**: `internal-docs/tests/SSP_Portal_[DATE]_[MODEL]/`
  
- [ ] **B1.4 Extract Findings**:
  - [ ] Which model benefits most from MCP?
  - [ ] Which prompting pattern works best per model?
  - [ ] Update SPEC.md with validated recommendations
  - [ ] Document MCP improvements needed (module validation, anti-patterns, etc.)
- [ ] **B1.5 Take screenshots** (blur identifiers)

### B2. External Repo (Optional)

- [ ] Clone angular-spotify, run MCP
- [ ] Capture `get_team_patterns` output (no blurring needed)

---

## Phase C: Launch Assets

- [ ] **C1. Finalize LinkedIn Post** (short version, 2-3 screenshots)
- [ ] **C1.1 Add screenshots to README.md - or MOTIVATION.md?**
- [ ] **C2. Final README check** (setup works with `npx`)
- [ ] **C3. Push final commits**
- [ ] **C4. Post on LinkedIn**

---

## Current Status

| Item | Status |
|------|--------|
| README ready | ✅ |
| Limitations documented | ✅ |
| MOTIVATION.md | ⏳ |
| Competitive analysis | ✅ |
| npm package ready | ⏳ Needs publish |
| Evidence screenshots | ⏳ Not done |
| LinkedIn post finalized | ⏳ Multiple versions exist |

---

## Validated Claims (December 2025)

| Claim | Evidence | Status |
|-------|----------|--------|
| "63.3% cite lack of context" | Stack Overflow 2024 | ✅ |
| "AI doubles code churn" | GitClear 2024 | ✅ |
| "98% inject usage" | Enterprise Portal validation | ✅ |
| "Jest 70%, Playwright 6%" | Enterprise Portal validation | ✅ |
| "Internal libraries detected" | @company/utils: 145 uses | ✅ |
| "Golden Files work" | main-toolbar 6/6 patterns | ✅ |
| "Reduces corrections" | A/B test pending | ⏳ |
| "Token reduction" | Cursor measurement pending | ⏳ |

---

## Architectural Vision

> **Always respect this**: The base architecture is designed to be language-agnostic with pluggable analyzers.

- **Current focus**: JS/TS codebases, Angular as primary specialized analyzer
- **Mid-term**: Tree-sitter for multi-language AST, React/Vue analyzers
- **Long-term**: Plugin system for community analyzers

See SPEC.md for full roadmap.

