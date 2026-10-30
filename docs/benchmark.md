# What our local code-context experiments show

This report describes local evidence from five ways of giving an AI coding agent context: Raw-native, Codebase Context, jCodeMunch, Repowise, and context-mode. The evidence is split into separate families because retrieval, repeated runs, full-agent observations, and a metered replay do not answer the same question. The families are not pooled into one score.

The clearest current finding is narrow: in this fixed retrieval setup, Codebase Context recovered 25.7% of expected gold files at 11.5% file precision, while fresh indexing had material local cost. These measurements do not show better completed coding tasks.

## Evidence families

| Evidence family | Attempts | Completed | Failed or otherwise excluded | What it answers |
| --- | ---: | ---: | ---: | --- |
| Corrected retrieval | 100 | 99 of 100 | 1 failed | Expected-file coverage, file precision, and reported `peakPrivateGb` |
| Repeated retrieval | 300 | 288 of 300 | 12 failed | Repeatability, setup, and runtime history |
| Full-agent pilot | 30 | 30 of 30 | 0 | Observed token and task-time results across two frozen tasks |
| Metered replay (excluded) | 100 | 100 counter records in historical summary | Tool-use validity unresolved | Why those replay records are not scored |

The first two families contain 400 retrieval attempts. The full-agent pilot and the metered replay remain separate from those retrieval measurements.

## Retrieval results

Expected-file coverage means expected gold files recovered divided by expected gold files, averaged within the corrected retrieval-only family. File precision means expected gold files recovered divided by all files returned. The table reports both alongside completion status and the reported `peakPrivateGb` telemetry field. The underlying unit of that field was not independently verified, so these values are not labelled as GiB or treated as install size.

| Tool | Completed | Failed | Expected-file coverage | File precision | Reported `peakPrivateGb` |
| --- | ---: | ---: | ---: | ---: | ---: |
| Raw search | 20/20 | 0 | 4.3% | 4.0% | 0.06 |
| Codebase Context | 20/20 | 0 | 25.7% | 11.5% | 2.90 |
| jCodeMunch | 20/20 | 0 | 27.1% | 11.0% | 0.33 |
| Repowise | 19/20 | 1 | 20.1% (failed run = 0) | 12.0% | 4.82 |
| context-mode | 20/20 | 0 | 16.8% | 11.7% | 0.15 |

The corrected retrieval family therefore includes 99 completed attempts and 1 failed attempt. Repowise is the only tool with a failed attempt in this table. Its 20.1% is failure-inclusive: the failed attempt is counted as zero. Raw search is a deterministic lexical adapter in this protocol, not a full normal coding-agent baseline. These values describe file retrieval and returned-file precision, not a coding score. The [sanitized evidence extract](../results/benchmark-presentation-evidence.json) records the exact values and source hashes.

## Paired token and time observation

The full-agent pilot used `gpt-5.4-mini-high`, with three runs per tool and task. It covers one frozen investigation task for each of two open-source codebases. The two tasks are PonyC and fmt. The paired tables compare the raw-native agent lane with Codebase Context; all five lanes remain available in the evidence extract.

### PonyC

| Tool | Input tokens | Cached input tokens | Output tokens | Reasoning output tokens | Task time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Raw search | 653,348 | 610,304 | 9,011 | 4,494 | 185,061 ms |
| Codebase Context | 223,558 | 190,976 | 5,564 | 3,024 | 114,664 ms |

### fmt

| Tool | Input tokens | Cached input tokens | Output tokens | Reasoning output tokens | Task time |
| --- | ---: | ---: | ---: | ---: | ---: |
| Raw search | 290,186 | 272,384 | 7,567 | 4,024 | 142,002 ms |
| Codebase Context | 247,868 | 206,848 | 7,930 | 4,784 | 143,643 ms |

All values above are medians across three `gpt-5.4-mini-high` runs for the named task and tool. Cached input is included in input and must not be added to input again. Each column is aggregated independently. Codebase Context used fewer input tokens in both examples, but its median task time was slightly longer on fmt. This does not establish better answers or patches.

The prompt requested at most 12 shell or tool calls. The CLI did not hard-enforce that request. The result describes observed agent behavior, not universal or hard-call-controlled savings.

## What can be reproduced from the public repository

The public repository snapshot at commit `cc54fb5` contains the [benchmark script](https://github.com/PatrickSys/codebase-context/blob/cc54fb5aee50ec177402e459b23be0fe8da7836e/scripts/contextbench-runner.mjs), [benchmark rules](https://github.com/PatrickSys/codebase-context/blob/cc54fb5aee50ec177402e459b23be0fe8da7836e/tests/fixtures/contextbench-benchmark-protocol.json), and [20-task manifest](https://github.com/PatrickSys/codebase-context/blob/cc54fb5aee50ec177402e459b23be0fe8da7836e/tests/fixtures/contextbench-task-manifest.json). Those links were reachable on October 5, 2026; earlier local-commit links were not. You can validate the checked-in fixtures with:

```bash
node scripts/contextbench-runner.mjs --validate-fixtures
```

They show the test structure and task format. They are not a byte-for-byte copy of every file used by the measured sessions; all three file hashes differ from the later 30-session pilot. The manifest names tasks and base commits but does not contain their full problem statements or gold-context values. The exact machine-specific raw run directories behind the 100-attempt retrieval table, the 300-attempt repeatability history, and the 30-session agent pilot are not checked into the public repository, so this checkout cannot regenerate the reported tables with one command. The [original schema-2 retrieval summary](../results/contextbench-engineering-note-summary.json) is preserved from local commit `18e0a43a90fe67e9df0d728b2134e9d430469883`; the [sanitized evidence extract](../results/benchmark-presentation-evidence.json) preserves the exact values and hashes used for this presentation. Fixture validation checks fixture consistency, not the reported measurements.

Local session artifacts retained outside this public checkout record Windows x64 with 16 logical CPUs, about 24 GiB of RAM, Node.js 24.14.1, Claude Code 2.1.173, and `gpt-5.4-mini-high` for the later agent pilot. Readers cannot independently inspect those environment files from this checkout. Exact version pins for all five tools in the retrieval families were not captured consistently enough to publish a trustworthy version matrix.

This makes the public evidence partially reproducible: the method and current fixtures are inspectable, while the exact reported runs are not independently replayable from this checkout alone. The tables should be read as a transparent engineering report, not a paper-grade reproduction package.

## Method and limits

The retrieval percentages, precision values, and reported `peakPrivateGb` fields come from the corrected retrieval-only family. The repeated retrieval family is reported as completion and repeatability history rather than merged into that table. The full-agent pilot reports input, cached input, output, reasoning output, and task time for two frozen investigation tasks. The metered replay is retained as history only and excluded from effectiveness or token-saving claims while tool-use validity is unresolved.

A historical fresh isolated Codebase Context indexing observation with embeddings enabled used the Transformers provider and `Xenova/bge-small-en-v1.5`. Its median was about 12 minutes 31 seconds. This is a historical observation in methodology and limits, not a normal-use estimate or a cross-tool speed ranking.

That index observation does not describe normal warm use, incremental indexing, query latency, install time, or cross-tool index-speed ranking. Shared model-cache state, actual GPU use, the exact scan, analysis, embedding, and storage stage durations, and equivalent cold work across competitors were not established by that observation.

The benchmark does not measure patch correctness, end-to-end task completion, or a universal token or time result. It also does not combine the four evidence families into a pooled score. Setup and run failures remain part of the record so that incomplete attempts are visible.

Historical note: the [earlier public report archive](./benchmark-prior-public-report.md) contains a one-task official pilot and a separate 24-task discovery report. Those records and their comparator statuses remain separate, are not folded into this current four-family summary, and retain their claim gates.

See the [comparison table](./comparison-table.md) for the retrieval family in a compact form. The repository walkthrough is in the [demo](./demo.md).

## Repo-kind operational smoke

This section records whether `init`, `reindex`, `status`, convention lookup (`map`, plus `style-guide`), edit preflight (`search --intent edit`), and symbol search (`refs`) finish with a usable payload. It is not a retrieval-quality score and it does not change the claim gates above. Wall times are one local run on Linux x64, Node.js 22.23.4, model-free indexing (embeddings skipped). Clones were `--depth 40`. A command is a pass only when it exits 0 and the payload is usable for that step.

Checked revisions:

| Kind | Repository | Commit |
| --- | --- | --- |
| NestJS backend | [brocoders/nestjs-boilerplate](https://github.com/brocoders/nestjs-boilerplate) | `9620f15` |
| Django app | [healthchecks/healthchecks](https://github.com/healthchecks/healthchecks) | `f6c46b5` |
| Go service | [dexidp/dex](https://github.com/dexidp/dex) | `b02ead0` |
| TypeScript frontend + Python FastAPI | [fastapi/full-stack-fastapi-template](https://github.com/fastapi/full-stack-fastapi-template) | `f4bcfab` |

`init --yes` detected Cursor from the home directory and wrote `.cursor/mcp.json` in each repo.

### Backend and mixed repositories

| Repo | init | reindex | status | conventions | edit preflight | symbol search |
| --- | --- | --- | --- | --- | --- | --- |
| NestJS boilerplate | Pass 0.68s | Pass 3.20s. 226 files, 694 chunks, indexer 2.60s | Fail 0.57s. Ready, but a new process omitted file and chunk counts | Pass 0.64s. Nest patterns and 428 import edges. `style-guide --query authentication` found no section | Pass 0.99s. Top hit `MailService`; impact includes `auth.service.ts`. `ready` is false | Pass 1.34s. `MailService`, 6 syntactic usages, complete |
| healthchecks (Django) | Pass 0.70s | Pass 4.09s. 1,018 files, 5,812 chunks analyzed, indexer 3.47s. Keyword index kept 5,000 | Fail 0.62s. Ready, counts and the 812-chunk omission were hidden | Fail 0.63s. Only pattern was RxJS at 100% adoption. Import edges 0. `style-guide --query contributing` matched `CONTRIBUTING.md` | Fail 1.58s. Low confidence (0.07). Abstain told the caller to refresh a current index. Top hits were not `format_duration` | Pass 0.71s. `format_duration`, 17 syntactic usages. `isComplete` false because the limit was 8 |
| dex (Go) | Pass 0.66s | Pass 3.88s. 485 files, 13,940 chunks analyzed, indexer 3.29s. Keyword index kept 5,000 | Fail 0.64s. Ready, counts and the 8,940-chunk omission were hidden | Fail 0.65s. Only pattern was RxJS at 100% adoption. Import edges 0. `style-guide --query connector` found no section | Fail 1.29s. Rank 2 was `retryOnConflict`, then the card said to refresh a current index. Low confidence 0.17 | Pass 0.70s. `retryOnConflict`, 8 syntactic usages, at the limit |
| full-stack FastAPI template | Pass 0.65s | Pass 3.21s. 180 files, 943 chunks, indexer 2.57s | Fail 0.59s. Ready, but a new process omitted file and chunk counts | Fail 0.70s for the Python API. Map patterns are React-only. Graph is 33 files and 91 edges, and the examples are TSX. `style-guide --query development` matched `CONTRIBUTING.md` | Fail 0.81s. Results include `delete_item` in `backend/app/api/routes/items.py`. Impact names generated TS client files. Low confidence 0.09, `ready` false | Pass 0.73s. `get_current_user`, 2 syntactic usages, both in `backend/app/api/deps.py`, which matches the source |

Edit requests were: NestJS password-reset mail via `MailService`; healthchecks downtime duration formatting; Dex Kubernetes conflict retry; full-stack superuser check before item delete.

The false RxJS pattern came from bare `Subject` in JWT claims and email headers. The refresh instruction came from the search candidate budget, not from stale files (`skippedFiles` was 0).

### After those three fixes

Re-checked on the same clones. This does not turn the failed convention or preflight cells into passes.

- `status` on a new process now reads persisted stats. healthchecks reports 5,000 searchable chunks of 5,812 (812 omitted). Dex reports 5,000 of 13,940 (8,940 omitted). NestJS (694) and the full-stack template (943) are under the cap, so they show counts only.
- After reindex, healthchecks (wall 2.22s, indexer 1.73s) and Dex (wall 2.18s, indexer 1.70s) no longer report RxJS. Their maps have no active patterns, no best examples, and 0 import edges.
- Edit preflight for the same Dex and healthchecks queries now says the candidate budget was exhausted and to narrow the query. Both stay `ready: false` with low confidence. Dex still ranks `retryOnConflict` second. healthchecks still does not surface `format_duration` in the top 5.
