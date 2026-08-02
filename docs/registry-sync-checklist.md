# Registry Sync Checklist

Use this checklist before publishing any relaunch-facing metadata or registry copy.
The purpose is to keep the public surface aligned with the checked-in discovery
gate and the separate local ContextBench case-study boundary.

## Required Artifacts

- `results/gate-evaluation.json` exists and still reports the current gate truth.
- `results/comparator-evidence.json` exists and still records every failed lane honestly.
- `docs/benchmark.md` matches the current gate numbers and limitations.
- `docs/comparison-table.md` matches the current comparator statuses, including `CodeGraphContext`.
- `docs/demo.md` uses real CLI output, not invented snippets.
- The local ContextBench case study is described as a 20-task, 100-row
  retrieval-overlap engineering note: 99 evaluator-completed rows and 1 retained
  Repowise `no_context_extracted` row, not a winner claim.

## Public Surfaces To Sync

- `README.md`
- `package.json`
- `docs/capabilities.md`
- `docs/client-setup.md`
- `docs/cli.md`
- npm package description and keywords derived from `package.json`

## Required Truth Checks

- If the gate is `pending_evidence`, say so explicitly.
- If the raw-Claude baseline still has `averageFirstRelevantHit: null`, say the baseline remains `pending_evidence`.
- If `codebase-memory-mcp` still reads comparator artifact `ok` but gate `failed`, say so explicitly.
- If any comparator lane is `setup_failed`, say so explicitly.
- For the older discovery gate, do not claim benchmark wins against `raw Claude Code`, `GrepAI`, `jCodeMunch`, `codebase-memory-mcp`, or `CodeGraphContext` without real metrics in `results/comparator-evidence.json`. The separate local ContextBench case study must use its checked-in summary boundary instead.
- Do not claim implementation quality from this discovery benchmark.
- Do not turn this discovery-only proof into relaunch-release, risky-edit, or patch-quality proof language.
- Do not mix the newer local ContextBench case study into the older discovery gate. The ContextBench case study currently allows only a narrow retrieval-overlap engineering-note framing.
- If local ContextBench is mentioned, also mention the blockers: one repeat per task/lane, retrieval-overlap only, provider-dollar costs not measured, one Repowise no-context row, and no public winner claim.
- Say the publication decision plainly: current material is only a narrow engineering note; a repeat/stability study is required for any winner, leaderboard, paper-grade, or resource-efficiency claim.
- Do not omit the current reranker fallback limitation if the proof run still shows `Protobuf parsing failed`.

## Before Registry Or README Updates

- Re-run the four proof commands from `docs/benchmark.md` if the evidence artifacts look stale.
- Reconfirm that `results/gate-evaluation.json` still reports `claimAllowed: false` before writing relaunch copy.
- Reconfirm that `results/gate-evaluation.json` still reports `suiteStatus: complete`.
- Reconfirm that `CodeGraphContext` remains represented in the comparison table even if the lane still fails.
- Reconfirm that local ContextBench wording still says the public winner-claim gate is closed.
- Reconfirm that release copy says "retrieval-overlap engineering note" before it says "benchmark".

## Release Stop Conditions

- Stop if the proof docs drift from the JSON artifacts.
- Stop if public copy implies a pass while the gate still says `pending_evidence`.
- Stop if registry metadata still uses broader positioning than the checked evidence can support.
- Stop if registry metadata presents setup/readiness failures as competitor quality losses.
- Stop if the copy implies a paper-grade or repeated-stability benchmark already exists.
