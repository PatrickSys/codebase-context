<!-- INTERNAL DOCUMENT - MCP Stress Test Results -->
<!-- Real-world validation on mycompany_Portal codebase -->

# MCP Stress Test: Critical Gap Analysis

**Date:** December 2025  
**Codebases:** mycompany_Portal

---

## What The MCP Gets RIGHT

### 1. Wrapper Detection (Excellent)

```
@mycompany/* → 336 uses
primeng direct → 3 uses
@mycompany/prime → 84 uses
```

**Verdict:** Would correctly steer AI away from raw `primeng`.

### 2. DI Pattern (Excellent)

```
inject() function → 98%
Constructor injection → 2%
```

**Verdict:** AI would use `inject()` correctly.

### 3. Testing Framework (Good but Complex)

```
Jest → 74%
Jasmine/Karma → 26%
```

**Warning:** Mixed codebase. AI needs to know WHICH tests use which framework. The MCP shows overall percentages but not per-file context.

### 4. Service Patterns (Excellent)

Found: `private readonly http = inject(HttpClient)` pattern everywhere.
**Verdict:** AI would generate services with correct style.

### 5. Toast Usage (Excellent)

Search for "toast" found `ToastEventService` with:

- `inject(EventsManagementService)` pattern
- Async event dispatch via `ShowToastEvent`
  **Verdict:** AI would NOT try to use raw PrimeNG toast.

---

## Critical Gaps Found

### Gap 1: NgModule vs Standalone Confusion

```
NgModule-based → 76%
Standalone → 24%
```

**Problem:** The codebase is migrating to standalone. New code should use standalone, but MCP shows NgModule as "primary." This could lead AI to generate incorrect boilerplate.

**Fix needed:** Add `status: "legacy"` vs `"preferred"` labeling. NgModule is legacy here.

---

### Gap 2: @ngx-translate Marked as "Internal"

```
@ngx-translate/core → 130 uses, "isInternal: true"
```

**Problem:** This is an EXTERNAL library (npm), not internal. The MCP incorrectly classifies it.

**Root cause:** The wrapper detection algorithm sees high usage + consistent namespace and assumes "internal."

**Non-blocking:** This doesn't break functionality, but the recommendation is misleading.

---

### Gap 3: No Canonical API Service Pattern

When I searched for "http client api service", I got multiple patterns:

- `ServiceConnectionsService` — correct
- `RolesApiService` — correct
- `PortalVersionService` — correct

But NO "golden file" was surfaced for API service creation.

**Problem:** AI has to synthesize from multiple examples. Should surface ONE canonical API service.

---

### Gap 4: Form Patterns Not Detected

Search for "form reactive FormBuilder FormGroup" returned irrelevant results.

**Problem:** The MCP doesn't detect form patterns (reactive vs template-driven).

**Non-blocking for MVP:** Forms are generic Angular, not team-specific.

---

### Gap 5: Jest vs Jasmine Per-File Context

The MCP shows:

```
Jest → 74%
Jasmine/Karma → 26%
```

But when AI generates tests for a specific file, it doesn't know which framework THAT module uses.

**Problem:** No per-directory or per-library testing framework detection.

**Workaround:** The MCP surfaces Jest as primary; this is acceptable for new code.

---

## What An AI Would Slip Without This MCP

| Scenario             | Without MCP                                  | With MCP                                          |
| -------------------- | -------------------------------------------- | ------------------------------------------------- |
| Create a service     | Uses `constructor(private x: X)`             | Uses `inject(X)` (98% pattern)                    |
| Add a toast          | Uses `primeng/toast` directly                | Uses `ToastEventService`                          |
| Create a dialog      | Uses `MatDialog` or raw PrimeNG              | Uses `DialogComponent` from `@mycompany/ui`       |
| Write tests          | Uses Jasmine syntax (Stack Overflow default) | Uses Jest (74% primary)                           |
| Import UI components | Imports from `primeng`                       | Imports from `@mycompany/*` or `@mycompany/prime` |

---

## Verdict

### MVP-Ready: YES

The MCP solves the **high-impact problems**:

- ✅ Internal library discovery
- ✅ Wrapper detection and recommendations
- ✅ DI pattern enforcement
- ✅ Testing framework detection
- ✅ Toast/Dialog/UI component guidance

### Not Blocking MVP

The identified gaps are **edge cases**, not critical failures:

- NgModule/Standalone labeling → Could add `status` field later
- @ngx-translate misclassification → Cosmetic, doesn't break recommendations
- No form pattern detection → Generic Angular, not team-specific

### Recommended Enhancements (Post-MVP)

1. Add `status: "legacy" | "preferred"` to patterns
2. Improve external vs internal library classification
3. Add per-directory testing framework context
