# Discovery Comparator Summary

This table summarizes the checked-in discovery-comparator evidence from
`results/comparator-evidence.json`. It belongs to the older discovery gate, not
the local ContextBench case study. It is a setup-status table first, not a marketing scoreboard.

Do not use this page to claim that `codebase-context` beat a competitor. A setup
failure means the lane did not reach metric-producing readiness in this
artifact; it is not a quality loss.

| Comparator | Intended role in gate | Current status | Evidence summary |
| --- | --- | --- | --- |
| `raw Claude Code` | Baseline for payload cost and at least one usefulness comparison | comparator artifact: `ok`; gate: `pending_evidence` | The Haiku-backed Claude CLI runner returns payloads in this artifact, but the checked-in baseline still has `averageFirstRelevantHit: null`, so the gate still records missing baseline metrics. |
| `GrepAI` | Named MCP comparator | `setup_failed` | Requires the GrepAI binary plus a local Ollama embedding setup that is not present in this proof environment. |
| `jCodeMunch` | Named MCP comparator | `setup_failed` | In this older discovery artifact, the MCP server closes on startup, so no comparable discovery metrics were produced. This does not override the separate local ContextBench strict-MCP row. |
| `codebase-memory-mcp` | Named MCP comparator | comparator artifact: `ok`; gate: `failed` | The repaired graph-backed runner produces real metrics in this artifact, but the frozen gate still fails this lane because `codebase-context` does not stay within tolerance on every required usefulness metric. |
| `CodeGraphContext` | Graph-native comparator in the relaunch frame | `setup_failed` | In this older discovery artifact, the MCP server closes on startup, so this lane remains missing evidence. |

## Reading This Table

- `setup_failed` means the lane was attempted and did not reach a credible metric-producing state.
- `pending_evidence` in the gate means the lane is still missing one or more required metrics.
- `failed` in the gate means the lane has real metrics, but the frozen comparison rule still does not pass.
- A missing metric is not treated as a win for `codebase-context`.
- The combined gate in `results/gate-evaluation.json` remains `pending_evidence`, and `claimAllowed` stays `false`, until these lanes produce real metrics.

## Checked-in codebase-context Result

For reference, the checked-in discovery output across `angular-spotify` and `excalidraw` is:

| Metric | codebase-context |
| --- | ---: |
| `totalTasks` | 24 |
| `averageUsefulness` | 0.75 |
| `averagePayloadBytes` | 7306.4583 |
| `averageEstimatedTokens` | 1827.0833 |
| `bestExampleUsefulnessRate` | 0.125 |
| `gate.status` | `pending_evidence` |

Those numbers are not compared here as head-to-head wins because the comparator lanes above did not produce matching metrics.
