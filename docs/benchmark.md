# Discovery Benchmark

This page documents the current public discovery proof from the checked-in result artifacts on `master`.
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
- `averageEstimatedTokens`: `1827.0833`
- `bestExampleUsefulnessRate`: `0.125`

Repo-level outputs from the same rerun:

| Repo | Tasks | Avg usefulness | Avg estimated tokens | Best-example usefulness |
| --- | ---: | ---: | ---: | ---: |
| `angular-spotify` | 12 | 0.8333 | 2138.4167 | 0.25 |
| `excalidraw` | 12 | 0.6667 | 1506.0833 | 0 |

## Gate Truth

The gate is intentionally still blocked.

- The combined suite covers both public repos.
- `claimAllowed` remains `false` because comparator evidence still does not support a benchmark-win claim.
- Two comparator artifacts now return `status: "ok"`, but that does not yet close the gate:
  - `raw Claude Code` still leaves the baseline `pending_evidence` because `averageFirstRelevantHit` is `null`
  - `codebase-memory-mcp` now has real current metrics, but the gate still marks it `failed` on the frozen tolerance rule
- Three comparator lanes still fail setup entirely: `GrepAI`, `jCodeMunch`, and `CodeGraphContext`.

## Comparator Reality

The current comparator artifact records incomplete comparator evidence, not benchmark wins.

| Comparator | Status | Current reason |
| --- | --- | --- |
| `codebase-memory-mcp` | comparator artifact: `ok`; gate: `failed` | Runs through the repaired graph-backed path and now records real metrics (`averageUsefulness: 0.1875`, `averageFirstRelevantHit: 1.2857`, `bestExampleUsefulnessRate: 0.5`), but the frozen gate still fails it on the required usefulness comparisons |
| `jCodeMunch` | `setup_failed` | `MCP error -32000: Connection closed` |
| `GrepAI` | `setup_failed` | Local Go binary and Ollama model path not present |
| `CodeGraphContext` | `setup_failed` | `MCP error -32000: Connection closed` |
| `raw Claude Code` | comparator artifact: `ok`; gate: `pending_evidence` | The explicit Haiku CLI runner now returns current metrics (`averageUsefulness: 0.0278`, `averageEstimatedTokens: 32.1667`), but the baseline still lacks `averageFirstRelevantHit`, so the gate keeps this lane as missing evidence |

`CodeGraphContext` remains part of the frozen comparison frame. It is not omitted from the public story just because the lane still fails to start.

## Important Limitations

- This benchmark measures discovery usefulness and payload cost only.
- It does not measure implementation correctness, patch quality, or end-to-end task completion.
- Comparator setup remains environment-sensitive, and the checked-in comparator outputs still do not satisfy the frozen claim gate.
- The reranker cache is currently corrupted on this machine. During the proof rerun, search fell back to original ordering after `Protobuf parsing failed` while still completing the harness.
- `averageFirstRelevantHit` remains `null` in the current gate output, which is enough to keep the raw-Claude baseline in `pending_evidence`.

## What This Proof Can Support

- It can support claims about the shipped discovery surfaces and their current measured outputs on the frozen public tasks.
- It can support claims that the proof gate is still blocked by comparator evidence.
- It cannot support claims that `codebase-context` beats the named comparators today.
- It cannot support claims about edit success, code quality, or implementation speed.
