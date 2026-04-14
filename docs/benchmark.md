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
- `averageEstimatedTokens`: `1822.25`
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
- Two comparator lanes now return `status: "ok"`, but both are effectively near-empty on the frozen tasks and contribute `0` average usefulness.
- Three comparator lanes still fail setup entirely.

## Comparator Reality

The current comparator artifact records incomplete comparator evidence, not benchmark wins.

| Comparator | Status | Current reason |
| --- | --- | --- |
| `codebase-memory-mcp` | `ok` | Runs, but the checked-in artifact still averages `0` usefulness and `5` estimated tokens per task, so it does not yet contribute meaningful benchmark evidence |
| `jCodeMunch` | `setup_failed` | `MCP error -32000: Connection closed` |
| `GrepAI` | `setup_failed` | Local Go binary and Ollama model path not present |
| `CodeGraphContext` | `setup_failed` | `MCP error -32000: Connection closed` |
| `raw Claude Code` | `ok` | Runs, but the checked-in artifact still averages `0` usefulness and only `18.5` estimated tokens per task, so it does not yet contribute meaningful benchmark evidence |

`CodeGraphContext` remains part of the frozen comparison frame. It is not omitted from the public story just because the lane still fails to start.

## Important Limitations

- This benchmark measures discovery usefulness and payload cost only.
- It does not measure implementation correctness, patch quality, or end-to-end task completion.
- Comparator setup remains environment-sensitive, and the checked-in comparator outputs are still too weak to justify a claim.
- The reranker cache is currently corrupted on this machine. During the proof rerun, search fell back to original ordering after `Protobuf parsing failed` while still completing the harness.
- `averageFirstRelevantHit` remains `null` in the current gate output because this compact response surface does not expose a comparable ranked-hit metric across the incomplete comparator set.

## What This Proof Can Support

- It can support claims about the shipped discovery surfaces and their current measured outputs on the frozen public tasks.
- It can support claims that the proof gate is still blocked by comparator evidence.
- It cannot support claims that `codebase-context` beats the named comparators today.
- It cannot support claims about edit success, code quality, or implementation speed.
