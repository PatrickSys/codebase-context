# Comparator Summary

This table summarizes the current comparator evidence from `results/comparator-evidence.json`.
It is a setup-status table first, not a marketing scoreboard.

| Comparator | Intended role in gate | Current status | Evidence summary |
| --- | --- | --- | --- |
| `raw Claude Code` | Baseline for payload cost and at least one usefulness comparison | comparator artifact: `ok`; gate: `pending_evidence` | The Haiku-backed Claude CLI runner now returns current payloads, but the checked-in baseline still has `averageFirstRelevantHit: null`, so the gate still records missing baseline metrics. |
| `GrepAI` | Named MCP comparator | `setup_failed` | Requires the GrepAI binary plus a local Ollama embedding setup that is not present in this proof environment. |
| `jCodeMunch` | Named MCP comparator | `setup_failed` | The MCP server still closes on startup during the current rerun, so no comparable discovery metrics were produced. |
| `codebase-memory-mcp` | Named MCP comparator | comparator artifact: `ok`; gate: `failed` | The repaired graph-backed runner now produces real current metrics, but the frozen gate still fails this lane because `codebase-context` does not stay within tolerance on every required usefulness metric. |
| `CodeGraphContext` | Graph-native comparator in the relaunch frame | `setup_failed` | The MCP server still closes on startup during the current rerun, so this lane remains missing evidence. |

## Reading This Table

- `setup_failed` means the lane was attempted and did not reach a credible metric-producing state.
- `pending_evidence` in the gate means the lane is still missing one or more required metrics.
- `failed` in the gate means the lane has real metrics, but the frozen comparison rule still does not pass.
- A missing metric is not treated as a win for `codebase-context`.
- The combined gate in `results/gate-evaluation.json` remains `pending_evidence`, and `claimAllowed` stays `false`, until these lanes produce real metrics.

## Current codebase-context result

For reference, the current combined discovery output across `angular-spotify` and `excalidraw` is:

| Metric | codebase-context |
| --- | ---: |
| `totalTasks` | 24 |
| `averageUsefulness` | 0.75 |
| `averagePayloadBytes` | 7306.4583 |
| `averageEstimatedTokens` | 1827.0833 |
| `bestExampleUsefulnessRate` | 0.125 |
| `gate.status` | `pending_evidence` |

Those numbers are not compared here as head-to-head wins because the comparator lanes above did not produce matching metrics.
