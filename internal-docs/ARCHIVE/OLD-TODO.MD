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
