# Discovery Benchmark

This page documents the current public proof slice for `v2.0.0`.
It is a discovery benchmark, not an implementation-quality benchmark.

## Scope

- Frozen fixtures:
  - `tests/fixtures/discovery-angular-spotify.json`
  - `tests/fixtures/discovery-excalidraw.json`
  - `tests/fixtures/discovery-benchmark-protocol.json`
- Frozen repos used in the current proof run:
  - `repos/angular-spotify`
  - `repos/excalidraw`
- Current gate artifact:
  - `results/gate-evaluation.json`
- Comparator evidence:
  - `results/comparator-evidence.json`

## How To Reproduce

Run the repo-local proof artifacts from the current `master` checkout:

```bash
node scripts/run-eval.mjs repos/angular-spotify --mode=discovery --fixture-a=tests/fixtures/discovery-angular-spotify.json --skip-reindex --output=results/codebase-context-angular-spotify.json
node scripts/run-eval.mjs repos/excalidraw --mode=discovery --fixture-a=tests/fixtures/discovery-excalidraw.json --skip-reindex --output=results/codebase-context-excalidraw.json
node scripts/benchmark-comparators.mjs --repos repos/angular-spotify,repos/excalidraw --output results/comparator-evidence.json
node scripts/run-eval.mjs repos/angular-spotify repos/excalidraw --mode=discovery --fixture-a=tests/fixtures/discovery-angular-spotify.json --fixture-b=tests/fixtures/discovery-excalidraw.json --competitor-results=results/comparator-evidence.json --skip-reindex --output=results/gate-evaluation.json
```

## Current Result

From `results/gate-evaluation.json`:

- `status`: `pending_evidence`
- `suiteStatus`: `complete`
- `claimAllowed`: `false`
- `totalTasks`: `24`
- `averageUsefulness`: `0.75`
- `averageEstimatedTokens`: `903.7083333333334`
- `bestExampleUsefulnessRate`: `0.125`

Repo-level outputs from the same rerun:

| Repo | Tasks | Avg usefulness | Avg estimated tokens | Best-example usefulness |
| --- | ---: | ---: | ---: | ---: |
| `angular-spotify` | 12 | 0.8333 | 1080.6667 | 0.25 |
| `excalidraw` | 12 | 0.6667 | 726.75 | 0 |

## Gate Truth

The gate is intentionally still blocked.

- The combined suite now covers both public repos.
- The release claim is still disallowed because comparator evidence remains incomplete.
- Missing evidence currently includes:
  - raw Claude Code baseline metrics
  - GrepAI metrics
  - jCodeMunch metrics
  - codebase-memory-mcp metrics
  - CodeGraphContext metrics

## Comparator Reality

The current comparator artifact records setup failures, not benchmark wins.

| Comparator | Status | Current reason |
| --- | --- | --- |
| `codebase-memory-mcp` | `setup_failed` | Installer path still points to the external shell installer |
| `jCodeMunch` | `setup_failed` | MCP server closes during startup |
| `GrepAI` | `setup_failed` | Local Go binary and Ollama model path not present |
| `CodeGraphContext` | `setup_failed` | MCP server closes during startup |
| `raw Claude Code` | `setup_failed` | Local `claude` CLI baseline is not installed/authenticated in this environment |

`CodeGraphContext` is explicitly part of the frozen comparison frame. It is not omitted from the public story just because the lane still fails to start.

## Important Limitations

- This benchmark measures discovery usefulness and payload cost only.
- It does not measure implementation correctness, patch quality, or end-to-end task completion.
- Comparator setup is still environment-sensitive, so the gate remains `pending_evidence`.
- The reranker cache is currently corrupted on this machine. During the proof rerun, search fell back to original ordering after `Protobuf parsing failed` while still completing the harness.
- `averageFirstRelevantHit` remains `null` in the current gate output because this compact response surface does not expose a comparable ranked-hit metric across the incomplete comparator set.

## What This Proof Can Support

- It can support claims about the shipped discovery surfaces and their current measured outputs on the frozen public tasks.
- It can support claims that the proof gate is still blocked by comparator evidence.
- It cannot support claims that `codebase-context` beats the named comparators today.
- It cannot support claims about edit success, code quality, or implementation speed.
