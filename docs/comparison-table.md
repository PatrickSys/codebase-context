# Corrected retrieval comparison

This table summarizes the corrected retrieval-only family across five local code-context tools. In this fixed setup, Codebase Context recovered 25.7% of expected gold files at 11.5% file precision; this does not show better completed coding tasks. Expected-file coverage means expected gold files recovered divided by expected gold files. File precision means expected gold files recovered divided by all files returned. The reported `peakPrivateGb` field is copied from retained telemetry; its underlying unit was not independently verified.

| Tool | Completed | Failed | Expected-file coverage | File precision | Reported `peakPrivateGb` |
| --- | ---: | ---: | ---: | ---: | ---: |
| Raw search | 20/20 | 0 | 4.3% | 4.0% | 0.06 |
| Codebase Context | 20/20 | 0 | 25.7% | 11.5% | 2.90 |
| jCodeMunch | 20/20 | 0 | 27.1% | 11.0% | 0.33 |
| Repowise | 19/20 | 1 | 20.1% (failed run = 0) | 12.0% | 4.82 |
| context-mode | 20/20 | 0 | 16.8% | 11.7% | 0.15 |

## Reading notes

- Expected-file coverage is the percentage of expected gold files recovered, averaged within the corrected retrieval-only family.
- File precision is the percentage of returned files that matched the expected gold files.
- The table covers 100 attempts: 99 completed and 1 failed. Repowise completed 19 of 20 attempts; the other tools completed 20 of 20.
- Repowise's 20.1% is failure-inclusive: its failed attempt is counted as zero.
- Raw search is a deterministic lexical adapter in this protocol, not a full normal coding-agent baseline.
- `peakPrivateGb` is a reported telemetry field, not a verified unit claim, install size, or steady-state idle memory.
- The full-agent pilot, paired token observations, repeated retrieval history, and metered replay are separate evidence families. Their values should not be added to this table; the replay remains excluded while tool-use validity is unresolved.
- The measurements do not establish patch correctness or end-to-end task completion. They also do not establish a universal token, time, or coding result.

The [sanitized evidence extract](../results/benchmark-presentation-evidence.json) records the exact values and source hashes.

Historical note: the [earlier public report archive](./benchmark-prior-public-report.md) contains a one-task official pilot and a separate 24-task discovery report; it remains separate and keeps its existing claim gates.
