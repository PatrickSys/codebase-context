# Benchmarks

This page tracks three separate benchmark surfaces:

- The ContextBench implementation pilot, which uses the official ContextBench evaluator on one frozen task and five lanes whose outputs it could inspect.
- The separate local ContextBench case study, which summarizes the corrected 20-task retrieval-overlap run.
- The older discovery benchmark, which measures local discovery usefulness and payload cost only.

None of these sections currently supports a broad benchmark-win claim.

## ContextBench Implementation Pilot

This is the current implementation-quality pilot for ContextBench. It has real official-evaluator output, but it is still a pilot because it covers one frozen task rather than the full frozen 20-task slice.

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

Only rows scored by the official ContextBench evaluator are included here. Setup failures, tool errors, empty predictions, and judge failures are counted separately from quality rows.

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
- Failed rows, or rows the evaluator could not inspect, stay out of the quality table.
- All required lanes produced evaluator-readable rows.
- Setup, index, and query costs are separate from quality.
- Timing and token fields exist or carry explicit unavailable reasons.
- The protocol is frozen and `claimAllowed` is `false`.
- The task manifest attests that lane outputs were not observed during task selection.

### What This Supports

- It supports saying that the benchmark harness can produce real official ContextBench scores across five lanes.
- It supports saying that setup/index/query cost and context/token cost are now tracked separately from quality.
- It supports saying that the one-task pilot found higher `codebase-context`
  overlap than the other inspected lanes on this specific task.

### What This Does Not Support

- It does not support claiming that `codebase-context` beats competitors overall.
- It does not support claiming patch correctness or productivity improvements.
- It does not replace the full frozen 20-task, repeated-run benchmark required for claim-bearing results.

## Separate ContextBench Case Study

This page also records a separate local ContextBench case study. It compares
five ways of giving code context to an agent on frozen open-source tasks:
`raw-native`, `codebase-context`, `jcodemunch-full-mcp`,
`repowise-selfhosted-mcp`, and `context-mode`. GrepAI is appendix-only after
bounded local indexing readiness failures.

Current case-study status, as of 2026-06-04:

- This is a narrow retrieval-overlap case study, not a benchmark-win claim.
- The corrected run has 20 tasks x 1 repeat x 5 lanes = 100 retrieval rows.
- The official ContextBench evaluator completed 99 rows. One Repowise row is
  retained as `judge_failed` because the evaluator reported
  `no_context_extracted`.
- The public-safe summary is checked in at
  `results/contextbench-engineering-note-summary.json`.
- The full run artifacts are local and ignored by git. The checked-in summary is
  the shareable evidence boundary.

Why one repeat: this artifact is the first corrected same-denominator pass after
the tool setup failures were bounded. It is enough to show what each lane
returned on the same frozen tasks and what that cost locally. It is not enough
to claim stability, confidence intervals, or a general leaderboard. A stronger
benchmark needs repeated runs on the same frozen protocol before those claims
open.

The table below uses the failure-inclusive metric view from the checked-in
summary. The row-count column is evaluator completion, not a quality grade. The
quality signal is in the coverage columns: how much expected file, symbol, span,
and line evidence the returned context overlapped. A row that cannot be
evaluated is counted as zero for the public mean, so failed evidence is not
hidden by completed-only averages.

| Lane                      | Evaluator completed | File coverage | Symbol coverage | Span coverage | Line coverage | Median index | Total row wall | Peak private RAM | Caveat                                                                                                                         |
| ------------------------- | ------------------: | ------------: | --------------: | ------------: | ------------: | -----------: | -------------: | ---------------: | ------------------------------------------------------------------------------------------------------------------------------ |
| `jcodemunch-full-mcp`     |               20/20 |         27.1% |           19.0% |          8.5% |          8.7% |       11.3 s |       10.9 min |          0.33 GB | Fast in this adapter run; cold install/cache boundary still needs care before cost claims                                      |
| `codebase-context`        |               20/20 |         25.7% |           14.0% |          8.6% |          8.8% |      750.8 s |      231.5 min |          2.90 GB | Completed all 20 rows locally, but was expensive to index with local Transformers embeddings                                   |
| `repowise-selfhosted-mcp` |               19/20 |         20.1% |            4.6% |          3.0% |          2.5% |      294.3 s |      200.7 min |          4.82 GB | Highest peak private memory here; every index exited nonzero with a documented benign failure mode, and one row had no extracted context |
| `context-mode`            |               20/20 |         16.8% |            2.7% |          1.2% |          1.1% |       18.6 s |       16.0 min |          0.15 GB | Lightweight and low-cost, with a lower recall ceiling in this run                                                              |
| `raw-native`              |               20/20 |          4.3% |            0.7% |          0.5% |          0.4% |          0 s |        6.8 min |          0.06 GB | Deterministic lexical baseline here, not a free-form raw-agent ceiling                                                         |

What this supports:

- a practical engineering note about what each tool returned on the same
  open-source tasks;
- a setup/index cost comparison with the exact mode used by each lane;
- failure accounting that includes the Repowise no-context row instead of
  dropping it;
- the plain-language takeaway: codebase-context completed all 20 rows but was
  expensive to index; jCodeMunch returned slightly higher file coverage and
  indexed much faster in this adapter run; context-mode had low index/memory
  cost with lower recall; Repowise used the most memory here, had nonzero index
  exits, and produced one no-context row.

What remains blocked:

- winner, best-tool, leaderboard, or paper-grade claims;
- generalized coding-quality or patch-correctness claims;
- resource-efficiency claims, because install/cache/provider-dollar costs are
  not fully normalized;
- confidence/stability claims, because this run has one repeat per lane/task;
- claims that setup failures or no-context rows are competitor quality losses.

Do not mix the benchmark tracks:

- The ContextBench implementation pilot above is a one-task official-evaluator
  pilot.
- The discovery benchmark below is the checked-in product discovery gate.
- The ContextBench case study above is a separate retrieval-overlap engineering
  note.
- `claimAllowed: false` still applies to broad product-win claims.

Audit trail:

- Checked-in engineering-note summary:
  `results/contextbench-engineering-note-summary.json`
- The summary records the source hashes, failed-row pointers, and blocked-claim
  status for audit.
- Full raw artifacts stay local and ignored by git; the checked-in summary is
  the public evidence boundary.

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

| Repo              | Tasks | Avg usefulness | Avg estimated tokens | Best-example usefulness |
| ----------------- | ----: | -------------: | -------------------: | ----------------------: |
| `angular-spotify` |    12 |         0.8333 |            2138.4167 |                    0.25 |
| `excalidraw`      |    12 |         0.6667 |            1506.0833 |                       0 |

## Discovery Gate Truth

The gate is intentionally still blocked.

- The combined suite covers both public repos.
- `claimAllowed` remains `false` because comparator evidence still does not support a benchmark-win claim.
- Two comparator artifacts return `status: "ok"` in this checked-in discovery artifact, but that does not close the gate:
  - `raw Claude Code` still leaves the baseline `pending_evidence` because `averageFirstRelevantHit` is `null`
  - `codebase-memory-mcp` has real metrics in this artifact, but the gate still marks it `failed` on the frozen tolerance rule
- In this older checked-in discovery artifact, three comparator lanes still fail
  setup entirely: `GrepAI`, `jCodeMunch`, and `CodeGraphContext`. That statement
  belongs only to the discovery artifact below, not to the separate local
  ContextBench case study above.

## Discovery Comparator Reality

The current comparator artifact records incomplete comparator evidence, not benchmark wins.

| Comparator            | Discovery-artifact status                           | Discovery-artifact reason                                                                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codebase-memory-mcp` | comparator artifact: `ok`; gate: `failed`           | Runs through the repaired graph-backed path and records metrics in this artifact (`averageUsefulness: 0.1875`, `averageFirstRelevantHit: 1.2857`, `bestExampleUsefulnessRate: 0.5`), but the frozen gate still fails it on the required usefulness comparisons |
| `jCodeMunch`          | legacy discovery artifact: `setup_failed`           | `MCP error -32000: Connection closed`; this does not override the separate local ContextBench strict-MCP row described above                                                                                                                                   |
| `GrepAI`              | legacy discovery artifact: `setup_failed`           | Local Go binary and Ollama model path not present; the newer local ContextBench track keeps GrepAI as appendix-only after bounded readiness failures                                                                                                           |
| `CodeGraphContext`    | `setup_failed`                                      | `MCP error -32000: Connection closed`                                                                                                                                                                                                                          |
| `raw Claude Code`     | comparator artifact: `ok`; gate: `pending_evidence` | The explicit Haiku CLI runner returns metrics in this artifact (`averageUsefulness: 0.0278`, `averageEstimatedTokens: 32.1667`), but the baseline still lacks `averageFirstRelevantHit`, so the gate keeps this lane as missing evidence                       |

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
