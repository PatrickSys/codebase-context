# Goal Prompt: Publishable ContextBench Benchmark

You are in `C:\Users\bitaz\Repos\codebase-context`. Read `AGENTS.md` first and obey it. Load memory first (`npx codebase-context memory list` or MCP memory if available). The user wants a worth-publishing ContextBench benchmark, not another proof-of-life run and not a biased scoreboard.

## Current Proven Baseline

A real five-lane scoreable proof run exists:

- Workflow run: `25644249279`
- Job: `75269988582`
- Artifact: `contextbench-five-lane-score`
- Artifact ID: `6908320478`
- Digest: `sha256:249a5df885bb5b4486b6ae2de6568867b4db97b74e4b46b9ea694f5a434dfa44`
- Task: `SWE-Bench-Pro__go__maintenance__bugfix__4df06349`
- Scoreable lanes: `raw-native`, `codebase-context`, `codebase-memory-mcp`, `grepai`, `ripgrep-lexical`
- Excluded lane: `CodeGraphContext`, because it indexed but returned zero task-relevant candidates via supported CLI. Do not count it unless a new readiness gate proves real candidates and official scoring.

This baseline proves the harness works. It is not yet publishable because it is one task and cost/token instrumentation is incomplete for some lanes.

## Objective

Turn the existing proof run into a publishable, reproducible, bias-resistant benchmark that compares context providers on quality, latency, token cost, setup/index/query cost, reliability, and infrastructure burden.

The benchmark must answer:

1. Which lane retrieves the most useful context according to the official evaluator?
2. How much time, setup, indexing, query work, and token budget does each lane consume?
3. How reliable is each lane across tasks and repositories?
4. Which results are statistically meaningful, and which are only anecdotal?
5. What failed, why, and what was excluded by pre-registered rules?

## Non-Negotiable Integrity Rules

- Use the official ContextBench evaluator for quality rows.
- Never count `setup_failed`, `index_failed`, `tool_error`, `empty_prediction`, or `judge_failed` as benchmark quality results.
- Report failed rows separately under reliability and setup/integration cost.
- Freeze the benchmark protocol before the main run: task set, competitors, budgets, metrics, failure policy, seeds, and analysis plan.
- Do not tune lane prompts, candidate caps, selector prompts, or scoring logic on the main benchmark set.
- Do not inspect gold patches/diffs while selecting predictions.
- Do not post-hoc remove bad results. Exclusions must follow the frozen protocol.
- If a lane cannot pass readiness, either fix the integration or exclude it with exact evidence. Do not invent a result.
- Keep setup/index/query cost separate from quality metrics.
- Do not overclaim in public text. If this remains a pilot, call it a pilot.

## Bias Controls

Before running the main benchmark:

1. Pre-register the protocol in a machine-readable artifact, preferably `benchmark-protocol.json` or equivalent existing benchmark config. Avoid unnecessary markdown sprawl.
2. Select tasks using a deterministic seed before looking at lane outputs.
3. Use the same frozen task set for every lane.
4. Stratify tasks by repository/language/domain when possible. If limited to Go/SWE-Bench-Pro, say that explicitly.
5. Keep a pilot set separate from the main set. Use the pilot only to debug infrastructure and instrumentation.
6. Freeze selector prompts after the pilot.
7. For LLM-based selection, feed only the problem statement and lane candidate pack. Never include gold files, gold spans, patches, or evaluator output.
8. Use the same selector model for all lanes unless the lane itself is being evaluated as an LLM system. Current required selector model: `gpt-5.4-mini-high`.
9. Preserve every artifact: readiness reports, candidate packs, predictions, official scores, timing logs, token logs, and failure logs.
10. Run an independent bias audit at the end: check leakage, cherry-picking, missing rows, prompt tuning, task selection, and inconsistent budgets.

## Required Metrics

Quality metrics from official evaluator:

- File coverage and precision
- Symbol coverage and precision
- Span coverage and precision
- Line coverage and precision
- Editloc recall and precision
- Per-task score rows, not only aggregate means

Cost and efficiency metrics per lane and per task:

- Setup duration
- Install/download duration if measurable
- Index duration
- Query duration
- Selector duration
- Official evaluator duration
- Total wall-clock duration
- Candidate count
- Candidate bytes/chars
- Candidate estimated tokens
- Prediction file count
- Prediction span count
- Peak memory if feasible in CI
- Disk footprint/download size if feasible
- Infra mode: local/no-infra, local-with-service, CI, Docker, external API, etc.

Token metrics per lane and per task:

- Prompt/input tokens
- Completion/output tokens
- Cached input tokens if available
- Reasoning tokens if available
- Total billed tokens if available
- Estimated candidate tokens using a tokenizer when provider usage is unavailable
- Mark tokens as `null` when truly unavailable. Do not fabricate.

Reliability metrics:

- Readiness pass/fail rate
- Setup failure rate
- Index failure rate
- Tool call failure rate
- Empty prediction rate
- Judge failure rate
- Retry count
- Timeout count

Statistical reporting:

- Mean, median, standard deviation, and bootstrap 95% confidence intervals per lane
- Paired per-task comparisons against `codebase-context` and simple baselines
- Effect sizes, not just p-values
- Failure-inclusive reliability tables separate from scoreable-only quality tables

## Competitor Policy

Start with the five scoreable lanes from the proof run:

- `raw-native`
- `codebase-context`
- `codebase-memory-mcp`
- `grepai`
- `ripgrep-lexical`

Treat `CodeGraphContext` as an attempted competitor, not a quality row, until readiness proves:

- setup/index works,
- lane tool is callable,
- candidate files/spans are non-empty,
- selected predictions are non-empty,
- official evaluator scores the row.

If adding more competitors, pre-register them before the main run. Do not add competitors after seeing main results unless clearly labeled as exploratory.

## Execution Plan For The Agent

1. Restore context.
   - Read `AGENTS.md`.
   - Load memory.
   - Inspect existing benchmark scripts/workflows/artifacts.
   - Confirm the proof run and artifact above.

2. Audit the current harness.
   - Locate readiness scripts, score scripts, selection files, workflows, and evaluator integration.
   - Identify all current `n/a` timing/token fields.
   - Replace `n/a` with measured values where possible, or explicit `null` plus `measurementUnavailableReason`.

3. Add a unified metrics schema.
   - Every lane/task row should emit one JSON object with quality, time, token, setup, infra, reliability, and provenance fields.
   - Add schema validation so incomplete metrics fail fast unless explicitly marked unavailable.

4. Add time instrumentation.
   - Measure setup/install, index, query, selector, evaluator, and total durations separately.
   - Use wall-clock timers around actual commands, not inferred estimates.
   - Preserve raw command logs and summarized JSON.

5. Add token instrumentation.
   - For OpenAI/API calls, capture usage metadata directly: input, output, cached, reasoning, total where available.
   - For Codex/subagent flows where direct API usage is unavailable, record provider usage as `null` and add deterministic estimated tokens for candidate/prompt text using a tokenizer.
   - For non-LLM lanes, record LLM tokens as zero only if no LLM was used; otherwise record the selector usage separately.

6. Pre-register the benchmark protocol.
   - Define sample size, task-selection seed, task filters, lane list, budgets, timeouts, retry policy, and exclusion policy.
   - Recommended sequence: pilot 5 tasks, then main 30+ tasks if CI budget allows. If budget is constrained, justify the smaller sample as a pilot.
   - Commit/configure the frozen protocol before running main results.

7. Run readiness gates.
   - Every required lane must pass readiness on the frozen task set or be excluded by protocol.
   - Readiness must prove setup/index, tool callability, non-empty candidates, non-empty predictions, and official scoring on at least a readiness slice.

8. Run the pilot.
   - Use the pilot only to debug integration and metrics collection.
   - Do not use pilot outcomes to tune the main task set or overfit prompts.

9. Freeze and run the main benchmark.
   - Run all lanes on the same task set.
   - Enforce same budgets where comparable: candidate caps, token caps, timeout caps, selector model, and output format.
   - Store all artifacts with digests.

10. Analyze results.
   - Produce scoreable-only quality tables.
   - Produce all-attempt reliability/failure tables.
   - Produce setup/index/query/time/token cost tables.
   - Produce paired statistical comparisons and confidence intervals.
   - Include failure analysis and limitations.

11. Audit for bias.
   - Use a fresh review pass to check protocol drift, gold leakage, cherry-picking, inconsistent budgets, hidden failures, and post-hoc exclusions.
   - If any integrity violation is found, stop and fix before publishing.

12. Publishable output.
   - Produce a concise technical report with method, task set, lanes, metrics, results, costs, failures, limitations, and reproduction commands.
   - Produce a human-readable summary for LinkedIn/Reddit only after the technical report is evidence-backed.
   - Do not claim general superiority beyond the measured sample.

## Acceptance Criteria

The task is complete only when:

- A frozen benchmark protocol exists.
- A multi-task benchmark run completes or a real blocker is documented.
- Every published quality number comes from official evaluator scoreable rows.
- Time and token metrics are present per lane/task or explicitly marked unavailable with reason.
- Setup/index/query costs are separate from quality scores.
- Reliability/failure tables include all attempted rows.
- Artifacts include enough provenance to reproduce the results.
- A bias audit finds no unresolved leakage, cherry-picking, or inconsistent-budget issue.
- The final report clearly distinguishes pilot evidence from publishable claims.

## Final Instruction

Do not optimize for a pretty number. Optimize for trust. If the retrieval is bad, say it is bad. If a lane is expensive, say it is expensive. If the sample is too small, call it a pilot. The benchmark is only worth publishing if a skeptical reader can reproduce it and see exactly where every number came from.
