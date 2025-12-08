<!-- INTERNAL DOCUMENT - Use case validation and audit results -->
<!-- Not for public release. See README.md for external documentation. -->

# MCP Use Case Audit: Generic AI vs. Codebase Context

**Date:** 2025-12-05
**Objective:** Assess whether `codebase-context-mcp` provides critical context for 7 real-world `mycompany_Portal` scenarios that a generic AI would miss.

## Executive Summary

The audit confirms that the MCP provides **essential, non-derivable context** in 7/7 scenarios. A generic AI without this context would consistently produce code that violates project standards (e.g., legacy DI, missing internal libraries, wrong widget structure).

| Scenario             | Critical Context Provided by MCP                          | Generic AI Outcome                               |
| :------------------- | :-------------------------------------------------------- | :----------------------------------------------- |
| **1. Admin Feature** | `ManagementGridComponent` pattern, `inject()`, `signal()` | Uses generic `<table>` or raw PrimeNG; Legacy DI |
| **2. New Widget**    | `providemycompanyTheme`, `createCustomElement`            | Generic Angular bootstrapping (wrong)            |
| **3. Extend Comp**   | `GridToolbarConfig` pattern, `handleAction`               | Adds button to HTML (breaking grid pattern)      |
| **4. New Service**   | `inject()`, `providedIn: 'root'`, `AppConfigService`      | Constructor injection (deprecated pattern)       |
| **5. Shared Comp**   | `signalInput` (88% usage)                                 | `@Input()` decorator (legacy)                    |
| **6. Excel Export**  | `handleToolbarAction` pattern                             | HTML button (architecturally wrong)              |
| **7. New Route**     | `AdminRoutes` enum location                               | Hardcoded string paths                           |

---

## Detailed Scenario Analysis

### 1. New Admin Feature (User Roles)

**Requirement:** Grid with Add/Edit/Delete actions.

- **Generic AI:** Scaffolds a generic HTML table or imports `TableModule` from PrimeNG directly. Uses constructor injection.
- **MCP Intelligence:**
  - **Usage:** Identifies `@mycompany/admin/shared` (used 3 times) containing `ManagementGridComponent`.
  - **Pattern:** Detects `inject()` (98%) and `signals` (41%).
  - **Canonical Example:** [connections-management.component.ts](file:///c:/Users/patrick.colom/Repos/mycompany_Portal/libs/admin/src/lib/service-connections/containers/connections-management/connections-management.component.ts) shows exact `gridColumns` + `actions` config.
- **Verdict:** MCP ensures architectural consistency; Generic AI creates tech debt.

### 2. New Widget ("Announcements")

**Requirement:** Standalone widget structure.

- **Generic AI:** Uses standard `bootstrapApplication` or `platformBrowserDynamic`. Missing internal theming.
- **MCP Intelligence:**
  - **Discovery:** Finds `widgets/launcher-widget/src/main.ts` via `@mycompany/utils` usage.
  - **Pattern:** Reveals `providemycompanyTheme` and `createCustomElement` pattern required for widgets.
  - **Wrappers:** Suggests `@mycompany/prime` instead of raw PrimeNG.
- **Verdict:** Generic AI code **would not run** in the portal environment (missing custom element wrapping).

### 3. Extend Existing Component (Bulk Delete)

**Requirement:** Add feature to connections grid.

- **Generic AI:** Adds a `<button>` to the component template.
- **MCP Intelligence:**
  - **Analysis:** Shows `ManagementGridComponent` is in use.
  - **Pattern:** [connections-management.component.ts](file:///c:/Users/patrick.colom/Repos/mycompany_Portal/libs/admin/src/lib/service-connections/containers/connections-management/connections-management.component.ts) reveals `GridToolbarConfig`.
  - **Correct Fix:** Add `'delete'` to `actionButtons` config, handle in `handleAction()`.
- **Verdict:** MCP guides correct configuration-driven extension; Generic AI breaks the UI pattern.

### 4. New Service (ThemePreferences)

**Requirement:** Fetch/cache settings.

- **Generic AI:** `constructor(private http: HttpClient) {}`
- **MCP Intelligence:**
  - **Pattern:** `inject()` (98%).
  - **Example:** [service-connections.service.ts](file:///c:/Users/patrick.colom/Repos/mycompany_Portal/libs/admin/src/lib/service-connections/services/connections/service-connections.service.ts) shows `private readonly http = inject(HttpClient);` and usage of `AppConfigService`.
- **Verdict:** MCP enforces modern Angular 17+ standards used by the team.

### 5. New Shared Component (StatusBadge)

**Requirement:** Reusable badge.

- **Generic AI:** `@Input() status: string;` (Decorator style).
- **MCP Intelligence:**
  - **Pattern:** `componentInputs` -> `signalInput` (88%).
  - **Style:** `Standalone` (24%) vs `NgModule` (76%) - prompts decision or follows emerging trend.
- **Verdict:** MCP prompts for the modern `input()` signal API which the team is migrating to.

### 6. Add Feature to Existing Page (Excel Export)

**Requirement:** Export button on widgets page.

- **Generic AI:** "Add a button to the top of the page".
- **MCP Intelligence:**
  - **Example:** [widgets-management-overview.component.ts](file:///c:/Users/patrick.colom/Repos/mycompany_Portal/libs/admin/src/lib/widgets-management/components/widgets-management-overview/widgets-management-overview.component.ts) shows `toolbarConfig` with `actionButtons` (e.g., "Check for Updates").
  - **Correct Fix:** Add export action to toolbar config, implement `onToolbarAction`.
- **Verdict:** MCP ensures "native" look-and-feel by using the grid toolbar system.

### 7. New Route/Page (Audit Log)

**Requirement:** Add route.

- **Generic AI:** hardcodes `'audit-log'` string in route definition.
- **MCP Intelligence:**
  - **Discovery:** Finds [admin-routes.enum.ts](file:///c:/Users/patrick.colom/Repos/mycompany_Portal/libs/common/src/lib/core/models/routes/admin-routes.enum.ts).
  - **Correct Fix:** Add `AUDIT_LOG = 'audit-log'` to enum, use enum in route definition.
- **Verdict:** MCP prevents magic strings and ensures type safety.

---

## Conclusion

The `codebase-context-mcp` is **highly effective**. It successfully surfaced the specific internal libraries (`@mycompany/*`, `@mycompany/*`), patterns (`ManagementGrid`, `ToolbarConfig`), and conventions (`inject`, `signals`) required to write correct code in this specific codebase. A generic AI would have failed to produce architecturally correct code in all 7 cases.
