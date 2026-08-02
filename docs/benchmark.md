# Benchmark Evidence

This page keeps two evidence tracks separate:

- the older checked-in discovery gate from result artifacts on `master`;
- the newer local ContextBench case study across five local/self-hosted code
  context tools.

Neither track is an implementation-quality benchmark.

## Separate ContextBench Case Study

This page also records a separate local ContextBench case study. It compares
five ways of giving code context to an agent on frozen open-source tasks:
`raw-native`, `codebase-context`, `jcodemunch-full-mcp`,
`repowise-selfhosted-mcp`, and `context-mode`. GrepAI is appendix-only after
bounded local indexing readiness failures.

Current case-study status, as of 2026-06-07:

- This is a narrow retrieval-overlap case study. It does not name a benchmark
  winner.
- The practical aggregate now shows 500 checks total: 400 retrieval/resource
  checks plus 100 checks with token counters.
- The official ContextBench evaluator scored 387 checks. Thirteen Repowise
  retrieval checks are retained as failed or no-usable-context evidence.
- The 100 token-metered checks completed 100/100 and captured input, cached
  input, output, and reasoning output counters for every tool.
- The public-safe summary is checked in at
  `results/contextbench-engineering-note-summary.json`.
- The full run artifacts are local and ignored by git. The checked-in summary is
  the shareable evidence boundary.

Why this is not a research-paper benchmark: this 500-check view combines local
evidence sets, not one preregistered repeated protocol. It is enough to show
what each tool returned on the same frozen tasks, what that cost locally, and
how many model tokens were used to read the returned context in the metered
replay. It is not enough to claim stability, confidence intervals, token
savings, patch quality, or a general leaderboard.

The table below uses the failure-inclusive metric view from the checked-in
summary. The checks-scored column is not a quality grade. The quality signal is
in the coverage columns: how much expected file, symbol, code-range, and line
evidence the returned context overlapped. A check that cannot be evaluated is
counted as zero for the public average, so failed evidence is not hidden.

| Tool                      | Retrieval scored | Expected files found | Expected symbols found | Expected code ranges found | Expected lines found | Typical index time | Total elapsed | Peak memory | Median tokens to read context | Caveat                                                                            |
| ------------------------- | ---------------: | -------------------: | ---------------------: | -------------------------: | -------------------: | -----------------: | ------------: | ----------: | ----------------------------: | --------------------------------------------------------------------------------- |
| `jcodemunch-full-mcp`     |            80/80 |                27.1% |                  18.9% |                       8.3% |                 8.5% |              4.8 s |      31.5 min |     0.33 GB |            18,162 in / 692 out | Slightly leads the aggregate retrieval metrics and indexed much faster here        |
| `codebase-context`        |            80/80 |                26.6% |                  12.9% |                       7.9% |                 8.4% |            736.2 s |     894.2 min |     2.90 GB |          19,345 in / 2,494 out | Close on retrieval, but expensive to index with local Transformers embeddings      |
| `repowise-selfhosted-mcp` |            67/80 |                17.6% |                   2.8% |                       2.0% |                 1.6% |            295.6 s |     750.4 min |     4.82 GB |            17,921 in / 694 out | Produced usable checks, but had checks with no usable context and used most memory |
| `context-mode`            |            80/80 |                14.0% |                   1.8% |                       1.2% |                 1.1% |             14.8 s |      56.1 min |     0.15 GB |            17,916 in / 673 out | Lightweight and low-cost, with lower expected-file coverage in this run            |
| `raw-native`              |            80/80 |                 4.3% |                   0.7% |                       0.5% |                 0.4% |                0 s |      25.4 min |     0.06 GB |          18,916 in / 1,017 out | Simple local file search baseline; no index tool                                  |

Token accounting:

The first 400 retrieval/resource checks were retrieval-only and still have no
model usage counters. To fill that gap, I ran 100 metered checks through Codex
CLI with `gpt-5.4-mini` and high reasoning effort: 20 tasks x 5 tools. All 100
captured input, cached input, output, and reasoning output tokens.

This table measures the model cost of reading each tool's returned context. It
does not measure a full patch workflow, developer productivity, token savings,
or a model-provider bill.

| Tool | Checks with token counters | Median input tokens | Median cached input tokens | Median output tokens | Median reasoning output tokens | Model-provider bill |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `raw-native` | 20/20 | 18,916 | 16,256 | 1,017 | 848 | not calculated |
| `codebase-context` | 20/20 | 19,345 | 16,256 | 2,494 | 2,348 | not calculated |
| `jcodemunch-full-mcp` | 20/20 | 18,162 | 16,256 | 692 | 516 | not calculated |
| `repowise-selfhosted-mcp` | 20/20 | 17,921 | 16,256 | 694 | 516 | not calculated |
| `context-mode` | 20/20 | 17,916 | 16,256 | 673 | 516 | not calculated |

That means per-tool context-consumption cost is now visible. Public
token-savings and pricing claims are still blocked until a patch workflow or
pricing calculation measures them directly.

What we did recover is separate: the Codex orchestration cost of creating,
debugging, running, documenting, and auditing the benchmark itself.

| Scope | Total tokens | Input tokens | Cached input tokens | Output tokens | Reasoning output tokens | How to read this |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Codex benchmark orchestration/meta-cost | ~3.33B | ~3.318B | ~3.179B | ~11.3M | ~3.27M | Cost of the benchmark work in Codex goal/session transcripts, not a per-task or per-tool runtime score |

Cached input is part of input. Reasoning output is reported separately when
available and should not be treated as a separate tool score.

What this supports:

- a practical engineering case study about what each tool returned on the same
  open-source tasks;
- a setup/index cost comparison with the exact mode used by each tool;
- a context-consumption token comparison for the returned evidence;
- failure accounting that includes the Repowise checks with no usable context
  instead of dropping them;
- the plain-language takeaway: jCodeMunch slightly leads retrieval and indexed
  much faster; codebase-context is close on retrieval but expensive to index;
  context-mode was cheap but thinner; Repowise was heavy and brittle here.

What remains blocked:

- winner, best-tool, leaderboard, or research-paper benchmark claims;
- generalized coding-quality or patch-correctness claims;
- token-savings claims, because the token table measures context consumption,
  not a full edit/test workflow;
- resource-efficiency claims, because install/cache/model-provider costs are
  not fully normalized;
- confidence/stability claims, because this 500-check aggregate combines local
  evidence sets instead of one preregistered repeated protocol;
- claims that setup failures or checks with no usable context are competitor quality losses.

Do not mix the two benchmark tracks:

- The older discovery gate below is the checked-in product discovery gate.
- The ContextBench case study above is a separate retrieval-overlap case study.
- `claimAllowed: false` still applies to broad product-win claims.

Audit trail:

- Checked-in case-study summary:
  `results/contextbench-engineering-note-summary.json`
- The summary records the aggregate source boundary, failed-check counts, and
  blocked-claim status without publishing ignored local run paths.
- Full raw artifacts stay local and ignored by git; the checked-in summary is
  the public evidence boundary.

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

| Repo              | Tasks | Avg usefulness | Avg estimated tokens | Best-example usefulness |
| ----------------- | ----: | -------------: | -------------------: | ----------------------: |
| `angular-spotify` |    12 |         0.8333 |            2138.4167 |                    0.25 |
| `excalidraw`      |    12 |         0.6667 |            1506.0833 |                       0 |

## Gate Truth

The gate is intentionally still blocked.

- The combined suite covers both public repos.
- `claimAllowed` remains `false` because comparator evidence still does not support naming a benchmark winner.
- Two comparator artifacts return `status: "ok"` in this checked-in discovery artifact, but that does not close the gate:
  - `raw Claude Code` still leaves the baseline `pending_evidence` because `averageFirstRelevantHit` is `null`
  - `codebase-memory-mcp` has real metrics in this artifact, but the gate still marks it `failed` on the frozen tolerance rule
- In this older checked-in discovery artifact, three comparators still fail
  setup entirely: `GrepAI`, `jCodeMunch`, and `CodeGraphContext`. That statement
  belongs only to the discovery artifact below, not to the separate local
  ContextBench case study above.

## Comparator Reality

The current comparator artifact records incomplete comparator evidence, not benchmark wins.

| Comparator            | Discovery-artifact status                           | Discovery-artifact reason                                                                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codebase-memory-mcp` | comparator artifact: `ok`; gate: `failed`           | Runs through the repaired graph-backed path and records metrics in this artifact (`averageUsefulness: 0.1875`, `averageFirstRelevantHit: 1.2857`, `bestExampleUsefulnessRate: 0.5`), but the frozen gate still fails it on the required usefulness comparisons |
| `jCodeMunch`          | legacy discovery artifact: `setup_failed`           | `MCP error -32000: Connection closed`; this does not override the separate local ContextBench strict-MCP check described above                                                                                                                               |
| `GrepAI`              | legacy discovery artifact: `setup_failed`           | Local Go binary and Ollama model path not present; the newer local ContextBench track keeps GrepAI as appendix-only after bounded readiness failures                                                                                                           |
| `CodeGraphContext`    | `setup_failed`                                      | `MCP error -32000: Connection closed`                                                                                                                                                                                                                          |
| `raw Claude Code`     | comparator artifact: `ok`; gate: `pending_evidence` | The explicit Haiku CLI runner returns metrics in this artifact (`averageUsefulness: 0.0278`, `averageEstimatedTokens: 32.1667`), but the baseline still lacks `averageFirstRelevantHit`, so the gate keeps this comparator as missing evidence                 |

`CodeGraphContext` remains part of the frozen comparison frame. It is not omitted from the public story just because the comparator still fails to start.

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
