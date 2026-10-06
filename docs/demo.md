# Demo Script

This walkthrough shows real CLI output captured from the open-source `angular-spotify` repository during a local proof run. That sample checkout is not bundled here.

To try the same CLI flow, use Node.js 22 or newer and open a terminal in the repository you want to inspect. These commands use published `codebase-context@2.2.0`; the CLI uses the current directory as the project root. MCP registration and project selection are covered in the [client setup guide](./client-setup.md).

The saved output below is from an earlier CLI run. It does not verify the current package or an MCP connection.

## 0. Build The Local Index

```bash
npx -y codebase-context@2.2.0 reindex
```

Run this before the first map or search in a repository. Later runs can use `reindex --incremental` after the code changes.

## 1. Start With The Conventions Map

```bash
npx -y codebase-context@2.2.0 map --json
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
npx -y codebase-context@2.2.0 search --query "auth headers" --intent edit --limit 3 --json
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
      "file": "repos/angular-spotify/libs/web/auth/util/src/lib/interceptors/auth.interceptor.ts:10-42",
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
npx -y codebase-context@2.2.0 patterns --category state --json
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
- File paths in the excerpts belong to that capture; your output will use the repository you run the command from.
- The benchmark documents observed local evidence and its limitations; this walkthrough demonstrates shipped behavior, not a universal performance or coding result.
