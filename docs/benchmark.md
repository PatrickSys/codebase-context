# Benchmarks

This page tracks two separate benchmark surfaces:

- The ContextBench implementation pilot, which uses the official ContextBench evaluator on one frozen task and five scoreable lanes.
- The older discovery benchmark, which measures local discovery usefulness and payload cost only.

Neither section currently supports a broad benchmark-win claim.

## ContextBench Implementation Pilot

This is the current implementation-quality pilot for ContextBench. It is real scoreable evidence, but it is still a pilot because it covers one frozen task rather than the full frozen 20-task slice.

### Scope

- Protocol: `tests/fixtures/contextbench-benchmark-protocol.json`
- Task manifest: `tests/fixtures/contextbench-task-manifest.json`
- Selection file: `scripts/contextbench-five-lane-selections.json`
- Workflow: `.github/workflows/contextbench-five-lane-score.yml`
- Required lanes: `raw-native`, `codebase-context`, `codebase-memory-mcp`, `grepai`, `ripgrep-lexical`
- Model used for selection: `gpt-5.4-mini-high`
- Target task: `SWE-Bench-Pro__go__maintenance__bugfix__4df06349`
- Repository under test: `navidrome/navidrome`
- Base commit: `537e2fc033b71a4a69190b74f755ebc352bb4196`

`CodeGraphContext` is not counted in this five-lane pilot because its supported CLI path indexed successfully but returned zero task-relevant candidates during readiness. That remains a readiness blocker, not a quality result.

### Current Audited Run

- Run: `25663469903`
- Job: `75329796667`
- Commit: `bbd3a8348aaec15809fd09dd8fc729e64df6d878`
- Artifact: `6915576867`
- Artifact digest: `sha256:718fd32049a2d98ed62fb0c15189d7dc9f1b027c202f286923de91d9f8985def`
- Artifact size: `88.9 KB`
- Uploaded files: `42`
- Status: `success`

The artifact contains `summary.json`, `publishable-summary.json`, `publishable-validation.json`, `humanized-summary.md`, logs, lane selections, lane predictions, and official evaluator score files. It intentionally excludes full cloned repos and evaluator caches so the evidence package is small enough to inspect.

### Quality Results

Only rows scored by the official ContextBench evaluator are included here. Setup failures, tool errors, empty predictions, and judge failures are reliability outcomes, not quality rows.

| Lane | File cov | File prec | Span cov | Span prec | Line cov | Line prec |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `raw-native` | 0.222 | 0.667 | 0.370 | 0.391 | 0.365 | 0.365 |
| `codebase-context` | 0.889 | 1.000 | 0.899 | 0.356 | 0.887 | 0.323 |
| `codebase-memory-mcp` | 0.222 | 0.667 | 0.346 | 0.380 | 0.315 | 0.337 |
| `grepai` | 0.333 | 0.500 | 0.048 | 0.042 | 0.059 | 0.061 |
| `ripgrep-lexical` | 0.222 | 0.667 | 0.401 | 0.341 | 0.419 | 0.302 |

### Cost And Telemetry

The report separates setup, indexing, query, selector, evaluator, and row-wall timing from quality. It also reports candidate counts, candidate token estimates when available, prediction token estimates, and selector token telemetry fields.

`n/a` means the measurement was explicitly unavailable, not zero and not a hidden failure. Current gaps are:

- Selector wall-clock and provider token telemetry were not captured in this proof artifact.
- `raw-native`, `codebase-context`, and `codebase-memory-mcp` emitted candidate counts but not candidate-pack bytes.
- `codebase-context` readiness did not emit index/query duration in the source artifact.

### Bias Controls

The generated `publishable-validation.json` must pass these checks before the report is treated as evidence:

- Quality rows come only from the official ContextBench evaluator.
- Failed or unscoreable rows stay out of the quality table.
- All required lanes are scoreable.
- Setup, index, and query costs are separate from quality.
- Timing and token fields exist or carry explicit unavailable reasons.
- The protocol is frozen and `claimAllowed` is `false`.
- The task manifest attests that lane outputs were not observed during task selection.

### What This Supports

- It supports saying that the benchmark harness can produce real official ContextBench scores across five lanes.
- It supports saying that setup/index/query cost and context/token cost are now tracked separately from quality.
- It supports saying that the one-task pilot found a strong `codebase-context` result on this specific task.

### What This Does Not Support

- It does not support claiming that `codebase-context` beats competitors overall.
- It does not support claiming patch correctness or productivity improvements.
- It does not replace the full frozen 20-task, repeated-run benchmark required for claim-bearing results.

## Discovery Benchmark

This section documents the current public discovery proof from the checked-in result artifacts on `master`.
It is a discovery benchmark, not an implementation-quality benchmark.

## Discovery Scope

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

## Discovery Reproduction

Run the repo-local proof artifacts from the current `master` checkout:

```bash
node scripts/run-eval.mjs repos/angular-spotify --mode=discovery --fixture-a=tests/fixtures/discovery-angular-spotify.json --skip-reindex --output=results/codebase-context-angular-spotify.json
node scripts/run-eval.mjs repos/excalidraw --mode=discovery --fixture-a=tests/fixtures/discovery-excalidraw.json --skip-reindex --output=results/codebase-context-excalidraw.json
node scripts/benchmark-comparators.mjs --repos repos/angular-spotify,repos/excalidraw --output results/comparator-evidence.json
node scripts/run-eval.mjs repos/angular-spotify repos/excalidraw --mode=discovery --fixture-a=tests/fixtures/discovery-angular-spotify.json --fixture-b=tests/fixtures/discovery-excalidraw.json --competitor-results=results/comparator-evidence.json --skip-reindex --output=results/gate-evaluation.json
```

## Discovery Current Result

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

## Discovery Gate Truth

The gate is intentionally still blocked.

- The combined suite covers both public repos.
- `claimAllowed` remains `false` because comparator evidence still does not support a benchmark-win claim.
- Two comparator artifacts now return `status: "ok"`, but that does not yet close the gate:
  - `raw Claude Code` still leaves the baseline `pending_evidence` because `averageFirstRelevantHit` is `null`
  - `codebase-memory-mcp` now has real current metrics, but the gate still marks it `failed` on the frozen tolerance rule
- Three comparator lanes still fail setup entirely: `GrepAI`, `jCodeMunch`, and `CodeGraphContext`.

## Discovery Comparator Reality

The current comparator artifact records incomplete comparator evidence, not benchmark wins.

| Comparator | Status | Current reason |
| --- | --- | --- |
| `codebase-memory-mcp` | comparator artifact: `ok`; gate: `failed` | Runs through the repaired graph-backed path and now records real metrics (`averageUsefulness: 0.1875`, `averageFirstRelevantHit: 1.2857`, `bestExampleUsefulnessRate: 0.5`), but the frozen gate still fails it on the required usefulness comparisons |
| `jCodeMunch` | `setup_failed` | `MCP error -32000: Connection closed` |
| `GrepAI` | `setup_failed` | Local Go binary and Ollama model path not present |
| `CodeGraphContext` | `setup_failed` | `MCP error -32000: Connection closed` |
| `raw Claude Code` | comparator artifact: `ok`; gate: `pending_evidence` | The explicit Haiku CLI runner now returns current metrics (`averageUsefulness: 0.0278`, `averageEstimatedTokens: 32.1667`), but the baseline still lacks `averageFirstRelevantHit`, so the gate keeps this lane as missing evidence |

`CodeGraphContext` remains part of the frozen comparison frame. It is not omitted from the public story just because the lane still fails to start.

## Discovery Important Limitations

- This benchmark measures discovery usefulness and payload cost only.
- It does not measure implementation correctness, patch quality, or end-to-end task completion.
- Comparator setup remains environment-sensitive, and the checked-in comparator outputs still do not satisfy the frozen claim gate.
- The reranker cache is currently corrupted on this machine. During the proof rerun, search fell back to original ordering after `Protobuf parsing failed` while still completing the harness.
- `averageFirstRelevantHit` remains `null` in the current gate output, which is enough to keep the raw-Claude baseline in `pending_evidence`.

## Discovery Claims Supported

- It can support claims about the shipped discovery surfaces and their current measured outputs on the frozen public tasks.
- It can support claims that the proof gate is still blocked by comparator evidence.
- It cannot support claims that `codebase-context` beats the named comparators today.
- It cannot support claims about edit success, code quality, or implementation speed.
