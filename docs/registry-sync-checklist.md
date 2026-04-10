# Registry Sync Checklist

Use this checklist before publishing any Phase 10-facing metadata or registry copy.
The purpose is to keep the public surface aligned with the current proof bundle.

## Required Artifacts

- `results/gate-evaluation.json` exists and still reports the current gate truth.
- `results/comparator-evidence.json` exists and still records every failed lane honestly.
- `docs/benchmark.md` matches the current gate numbers and limitations.
- `docs/comparison-table.md` matches the current comparator statuses, including `CodeGraphContext`.
- `docs/demo.md` uses real CLI output, not invented snippets.

## Public Surfaces To Sync

- `README.md`
- `package.json`
- `docs/capabilities.md`
- `docs/client-setup.md`
- `docs/cli.md`
- npm package description and keywords derived from `package.json`

## Required Truth Checks

- If the gate is `pending_evidence`, say so explicitly.
- If any comparator lane is `setup_failed`, say so explicitly.
- Do not claim benchmark wins against `raw Claude Code`, `GrepAI`, `jCodeMunch`, `codebase-memory-mcp`, or `CodeGraphContext` without real metrics in `results/comparator-evidence.json`.
- Do not claim implementation quality from this discovery benchmark.
- Do not omit the current reranker fallback limitation if the proof run still shows `Protobuf parsing failed`.

## Before Registry Or README Updates

- Re-run the four proof commands from `docs/benchmark.md` if the evidence artifacts look stale.
- Reconfirm that `results/gate-evaluation.json` still reports `claimAllowed: false` before writing relaunch copy.
- Reconfirm that `results/gate-evaluation.json` still reports `suiteStatus: complete`.
- Reconfirm that `CodeGraphContext` remains represented in the comparison table even if the lane still fails.

## Release Stop Conditions

- Stop if the proof docs drift from the JSON artifacts.
- Stop if public copy implies a pass while the gate still says `pending_evidence`.
- Stop if registry metadata still uses broader positioning than the proof bundle can support.
