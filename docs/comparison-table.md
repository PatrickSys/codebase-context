# Comparator Summary

This table summarizes the current comparator evidence from `results/comparator-evidence.json`.
It is a setup-status table first, not a marketing scoreboard.

| Comparator | Intended role in gate | Current status | Evidence summary |
| --- | --- | --- | --- |
| `raw Claude Code` | Baseline for payload cost and at least one usefulness comparison | `setup_failed` | The local `claude` CLI baseline is unavailable in this environment, so the gate records missing baseline metrics. |
| `GrepAI` | Named MCP comparator | `setup_failed` | Requires the GrepAI binary plus a local Ollama embedding setup that is not present in this proof environment. |
| `jCodeMunch` | Named MCP comparator | `setup_failed` | The MCP server still closes on startup during the current rerun, so no comparable discovery metrics were produced. |
| `codebase-memory-mcp` | Named MCP comparator | `setup_failed` | The documented install path still depends on the external shell installer instead of a working local benchmark path. |
| `CodeGraphContext` | Graph-native comparator in the relaunch frame | `setup_failed` | The MCP server still closes on startup during the current rerun, so this lane remains missing evidence. |

## Reading This Table

- `setup_failed` means the lane was attempted and did not reach a credible metric-producing state.
- A missing metric is not treated as a win for `codebase-context`.
- The combined gate in `results/gate-evaluation.json` remains `pending_evidence` until these lanes produce real metrics.

## Current codebase-context result

For reference, the current combined discovery output across `angular-spotify` and `excalidraw` is:

| Metric | codebase-context |
| --- | ---: |
| `totalTasks` | 24 |
| `averageUsefulness` | 0.75 |
| `averagePayloadBytes` | 3613.6667 |
| `averageEstimatedTokens` | 903.7083 |
| `bestExampleUsefulnessRate` | 0.125 |
| `gate.status` | `pending_evidence` |

Those numbers are not compared here as head-to-head wins because the comparator lanes above did not produce matching metrics.
