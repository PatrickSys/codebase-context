# Portal AI Failure Log

> **Purpose**: Document specific instances where AI coding assistants fail in the SSP_Portal codebase. This log will inform MCP feature priorities by providing **concrete evidence** of gaps.

---

## How to Use This Log

When you observe an AI agent (Codex, Copilot, Cursor, Gemini, Claude) generating incorrect code, document it here with:
1. **The Task**: What was the AI asked to do?
2. **The Failure**: What did it generate incorrectly?
3. **The Correct Answer**: What should it have generated?
4. **Root Cause Hypothesis**: Why did the AI fail?
5. **MCP Relevance**: Could the MCP have prevented this?

---

## Failure Log

### Failure #001: Constructor Injection in inject() Codebase
| Field | Value |
|---|---|
| **Date** | December 2025 |
| **Model** | Gemini 3 Pro Preview |
| **Task** | "Create a user settings component." |
| **Failure** | Generated `constructor(private http: HttpClient)`. |
| **Correct** | `private readonly http = inject(HttpClient);` |
| **Root Cause** | Model training data is heavily biased toward older Angular patterns. No codebase-specific context was provided. |
| **MCP Relevance** | ✅ **High**. `get_team_patterns` shows "inject(): 97%". If the model had this context, it would have used the correct pattern. |

---

### Failure #002: Raw PrimeNG Instead of Wrapper
| Field | Value |
|---|---|
| **Date** | December 2025 |
| **Model** | Grok Code |
| **Task** | "Add a toast notification." |
| **Failure** | Generated `import { ToastModule } from 'primeng/toast';` and used raw PrimeNG API. |
| **Correct** | Use `ToastEventService` from `@mycompany/core`. |
| **Root Cause** | Model has no visibility into internal library wrappers. Defaulted to the public npm package. |
| **MCP Relevance** | ✅ **High**. `get_component_usage` shows `@mycompany/core: 847 uses` vs `primeng/toast: 3 uses`. |

---

### Failure #003: Native HTML Instead of Design System
| Field | Value |
|---|---|
| **Date** | December 2025 |
| **Model** | GPT 5.1-High |
| **Task** | "Create a user settings form." |
| **Failure** | Generated `<select>` and `<input>` with hardcoded CSS. |
| **Correct** | Use `<cb-dropdown>` and `<cb-input>` from `@codeblue/components`. |
| **Root Cause** | The "GPT-5.1 Paradox" — MCP provided structural context (services, DI) but **zero** UI component context. Model trusted MCP as complete, so it assumed no design system existed. |
| **MCP Relevance** | 🔴 **Critical Blind Spot**. MCP lacks `get_ui_components` or `get_design_tokens`. Must add to v1.3+. |

---

### Failure #004: Jest/Jasmine Confusion
| Field | Value |
|---|---|
| **Date** | December 2025 |
| **Model** | Claude Sonnet |
| **Task** | "Write tests for the UserService." |
| **Failure** | Generated Jasmine syntax (`spyOn`, `it`). |
| **Correct** | Use Jest syntax (`jest.fn()`, `test`). |
| **Root Cause** | Codebase is mixed (74% Jest, 26% Jasmine). Global stats are insufficient. The specific module was 100% Jest, but the model didn't know. |
| **MCP Relevance** | ⚠️ **Partial**. MCP provides global stats but lacks **Local Context Resolution** (per-directory patterns). Add to v1.3. |

---

### Failure #005: Missing Design Pattern (Signals)
| Field | Value |
|---|---|
| **Date** | December 2025 |
| **Model** | Gemini 3 Pro Preview (-MCP) |
| **Task** | "Create a reactive state for user preferences." |
| **Failure** | Generated `BehaviorSubject` from RxJS. |
| **Correct** | Use `signal()` from `@angular/core`. Team is migrating to Signals. |
| **Root Cause** | AI has no visibility into the *direction* of the codebase. It sees RxJS is dominant (70%) and assumes that's the standard. |
| **MCP Relevance** | ✅ **Solved by Pattern Momentum (v1.1)**. `trend: "Declining"` for RxJS vs `trend: "Rising"` for Signals. |

---

## Summary Statistics

| Root Cause Category | Count | MCP Coverage |
|---|---|---|
| DI Pattern Mismatch | 1 | ✅ `get_team_patterns` |
| Internal Library Unawareness | 1 | ✅ `get_component_usage` |
| UI/Design System Blindness | 1 | 🔴 Missing tool |
| Local Context Resolution | 1 | 🟡 Planned v1.3 |
| Design Pattern Direction | 1 | ✅ Pattern Momentum |

---
*Last updated: December 2025*
