# Demo Script

This walkthrough uses real CLI output captured against `repos/angular-spotify` during the Phase 10 proof rerun.
Run it from the repo root with `CODEBASE_ROOT` pointed at the frozen sample repo. The public flow is simple: start with the conventions map, then search for the local example you need.

## 1. Start With The Conventions Map

```bash
$env:CODEBASE_ROOT='C:\Users\bitaz\Repos\codebase-context\repos\angular-spotify'
node dist/index.js map --json
```

Captured output excerpt:

```json
{
  "project": "angular-spotify",
  "architecture": {
    "layers": [
      { "name": "libs", "fileCount": 252 },
      { "name": "apps", "fileCount": 6 }
    ]
  },
  "activePatterns": [
    { "name": "Effect", "adoption": "100%", "trend": "Rising" },
    { "name": "Standalone", "adoption": "100%", "trend": "Rising" },
    { "name": "RxJS", "adoption": "98%", "trend": "Rising" }
  ],
  "bestExamples": [
    { "file": "src/lib/card.component.ts", "score": 4, "reason": "Angular TestBed" }
  ]
}
```

What this shows:

- The first call gives a compact conventions map instead of raw grep output.
- The response already includes architecture layers, active patterns, and a concrete best example.

## 2. Search With Edit Intent

```bash
$env:CODEBASE_ROOT='C:\Users\bitaz\Repos\codebase-context\repos\angular-spotify'
node dist/index.js search --query "auth headers" --intent edit --limit 3 --json
```

Captured output excerpt:

```json
{
  "status": "success",
  "searchQuality": { "status": "ok", "confidence": 1 },
  "preflight": {
    "ready": true,
    "warnings": [
      "Index is aging (>24h) — results may not reflect recent changes"
    ],
    "patterns": {
      "do": [
        "Constructor injection — 85% adoption",
        "Standalone — 100% adoption",
        "RxJS — 98% adoption"
      ]
    },
    "bestExample": "src/lib/card.component.ts"
  },
  "results": [
    {
      "file": "C:\\Users\\bitaz\\Repos\\codebase-context\\repos\\angular-spotify\\libs\\web\\auth\\util\\src\\lib\\interceptors\\auth.interceptor.ts:10-42",
      "type": "interceptor:core"
    }
  ]
}
```

What this shows:

- Search is the second step after the map, not a separate headline workflow.
- `intent=edit` adds preflight evidence instead of forcing a separate call.
- The response stays compact while still surfacing a best example and impact hints.

## 3. Check A Team Pattern Directly

```bash
$env:CODEBASE_ROOT='C:\Users\bitaz\Repos\codebase-context\repos\angular-spotify'
node dist/index.js patterns --category state --json
```

Captured output excerpt:

```json
{
  "patterns": {
    "stateManagement": {
      "primary": {
        "name": "RxJS",
        "frequency": "98%",
        "trend": "Rising"
      },
      "alsoDetected": [
        {
          "name": "Signals",
          "frequency": "2%",
          "trend": "Rising"
        }
      ]
    }
  }
}
```

What this shows:

- The tool distinguishes dominant patterns from emerging ones.
- The map/search story is backed by direct pattern evidence rather than generic prose.

## Caveats

- These excerpts were captured from the current local proof run and will change if the frozen sample repo or index state changes.
- The discovery benchmark gate is still `pending_evidence`, and `claimAllowed` remains `false`, so this walkthrough demonstrates shipped behavior, not a released performance claim.
