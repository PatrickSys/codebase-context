
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

