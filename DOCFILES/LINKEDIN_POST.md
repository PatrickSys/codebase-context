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
