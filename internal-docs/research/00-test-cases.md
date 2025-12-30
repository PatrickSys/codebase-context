<!-- INTERNAL DOCUMENT - Testing analysis and failure mode documentation -->
<!-- Not for public release. See README.md for external documentation. -->

# Task Analysis: UserPreferencesService & Tests

## 1. The Task

**Goal:** Create a new `UserPreferencesService` that stores user settings, using `codebase-context-mcp` tools, without reading existing file content.

## 2. MCP Performance Assessment

### ✅ Where it Helped (The "Hero" Moments)

The MCP was critical in preventing "Legacy Angular" patterns from being generated.

- **Identified Signals vs. RxJS:** The `teamPatterns` output explicitly showed "Angular Signals" at 64% usage vs RxJS at 32%. This prevented the default use of `BehaviorSubject`.
- **Enforced DI Style:** It enforced functional injection (`inject()`) over constructor injection (97% frequency).
- **Located Style Guide:** It retrieved the specific `coding-style.md` without manual searching, providing rules on member ordering and access modifiers.

### ❌ Where it Failed (The "Testing" Gap)

I generated a test file using **Jasmine/Karma** syntax (`spyOn`, `it`), ignoring the fact that the project uses **Jest**.

- **The Info Was There:** The `mcp_get_codebase_metadata` output _did_ contain `"testingFrameworks": ["Jest"]` and referenced a `Testing Guidelines (Jest)` section in the style guide.
- **Why I Missed It:** The information was virtually invisible due to **low Signal-to-Noise Ratio**. The critical "Jest" configuration was a single line buried in a large JSON dump of dependencies (`@angular/cdk`, logic libraries, etc.) and project statistics.
- **Training Bias:** Without a "Red Alert" level signal, LLM training bias (Angular ≈ Jasmine) wins.

## 3. Improvement Recommendations

### A. Elevate "Team Patterns"

The `teamPatterns` section is the high-value output. It currently tracks _Dependency Injection_, _State Management_, and _Inputs_.
**Improvement:** It MUST track **Testing Frameworks**.
If the output had shown:

```json
"teamPatterns": {
  "testing": {
     "primary": { "name": "Jest", "frequency": "100%" }
  }
}
```

I would have caught it immediately.

### B. "Diff" Based Reporting

Instead of dumping `dependencies` which lists everything (including standard Angular packages), the MCP should only list **Significant Technical Decisions**.

- _Don't show:_ `@angular/core`, `@angular/router` (Every Angular app has these).
- _Do show:_ `Jest` (Deviation from standard), `Tailwind` (if present), `NgRx` (Explicit choice).

### C. Context-Aware Filtering

When I ask for metadata to "Create a Service", the MCP tools return broad project stats (`totalLines`, `componentsByLayer`).
**Improvement:** The tools should allow narrowing intent. If I am building a service, I need architectural patterns; I don't need to know there are 611 files in the repo. Reducing the noise allows the constraints (like "Use Jest") to stand out.

## 4. Task Analysis: Architecture Overview & Library Roles

### 1. The Task

**Goal:** Provide an overview of architecture, libraries, and conventions using `codebase-context-mcp`.

### 2. MCP Performance Assessment

### ❌ Where it Failed (Library Misclassification)

I incorrectly stated that `@mycompany/*` libraries generally wrap PrimeNG. The User clarified that `mycompany/utils` is UI-agnostic and `mycompany/core` is for event communication.

- **The Cause:** The `mcp_get_team_patterns` tool returned a misleading `libraryWrappers` analysis:
  ```json
  {
    "internal": "@mycompany/*",
    "likelyWraps": "primeng",
    "packages": ["@mycompany/utils", "@mycompany/common", ...]
  }
  ```
- **The Error:** The MCP **over-generalized** based on the namespace (`@mycompany/*`). It likely found PrimeNG usage in _one_ `@mycompany` library and tainted the entire namespace with that attribute. It failed to distinguish between **feature layers** (UI vs. specific Utils vs. Core).

### 3. Improvement Recommendations

### A. Granular Package Analysis

The Analyzer must stop treating namespaces (wildcards like `@mycompany/*`) as a single unit for architectural classification. It should analyze each library path (e.g., `libs/mycompany-core`, `libs/utils`) individually.

### B. Dependency-Based tagging

A library should only be flagged as "wrapping X" if it has a **direct dependency** on X in its specific context or `package.json`.

- `libs/utils`: No PrimeNG imports? -> **Tag: Utility/Agnostic**.
- `libs/ui`: Imports PrimeNG? -> **Tag: UI/Wrapper**.

### C. Content-Type Heuristics

The MCP should classify library roles based on file types:

- Mostly `*.ts` (no HTML/SCSS) = **Logic/Core** (matches `mycompany/core`).
- Mostly properties/interfaces = **Models/API**.
- Mix of Components/SCSS = **UI Library**.

## 5. Task Analysis: Admin User Roles (Real Quality Check)

### 1. The Task

**Goal:** Add a new admin section for managing user roles (Grid with Add/Edit/Delete) using `codebase-context-mcp` tools.

### 2. MCP Performance Assessment

### ✅ Where it Helped (Baseline Quality Achieved)

The MCP successfully shifted the output from "Generic Angular Tutorial Code" to "Team-Specific Implementation".

- **Pattern Enforcement (High Value):**

  - `mcp_get_codebase_metadata` explicitly flagged:
    - `"inject() function": "97%"` (prevented Constructor Injection).
    - `"Angular Signals": "64%"` (prevented BehaviorSubjects).
  - **Result:** The generated code used `readonly roles = signal<UserRole[]>...` and `private readonly translate = inject(TranslateService)`, matching the codebase's modern style perfectly.

- **Architectural Reuse (High Value):**
  - `mcp_search_codebase` (Query: "table grid user") correctly identified `ManagementGridComponent` in `libs/admin` as the preferred implementation over a raw PrimeNG table.
  - **Result:** I reused the `mycompany-admin-management-grid` instead of creating technical debt (duplication).

### ❌ Where it was Noise

- **Tool:** `mcp_get_analyzer_info`.
  - **Result:** Pure implementation detail (listing file extensions supported). provided zero value to the coding task.
  - **Impact:** Wasted context window.

### 3. Verdict on "Real Quality"

The MCP is **effective at enforcing patterns and discovery**, but relies heavily on the User knowing _which_ of its outputs to trust.

- **Metadata Tool:** The "Team Patterns" section is the MVP for quality.
- **Search Tool:** Essential for "Do we already have this?" checks.
- **Analyzer Tool:** Currently useless for the end-user.
