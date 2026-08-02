# Registry Sync Checklist

Use this checklist before publishing any relaunch-facing metadata or registry copy.
The purpose is to keep the public surface aligned with the checked-in discovery
gate and the separate local ContextBench case-study boundary.

## Reviewer Quick Read

This branch prepares the public story for `codebase-context@2.3.0`; it does not
publish the package or update live npm/GitHub metadata by itself.

Review the change as three linked surfaces:

- Product surface: README, package metadata, setup docs, and capability docs now
  describe Codebase Context as local code context for AI coding agents.
- Evidence surface: the benchmark docs describe one narrow practical case study:
  20 open-source tasks, 5 tools, and 500 checks total. It reports retrieval
  overlap, setup/index cost, memory, failures, and token cost to read returned
  context.
- Release safety: guard tests and workflows keep live publishing gated by owner
  approval, package preview, matching release tag, and live metadata checks.

Do not review this as a leaderboard or product-win claim. The checked evidence
still blocks winner, token-savings, patch-quality, productivity, model-provider
bill, resource-efficiency, and research-paper benchmark claims.

## Required Artifacts

- `results/gate-evaluation.json` exists and still reports the current gate truth.
- `results/comparator-evidence.json` exists and still records every failed comparator honestly.
- `docs/benchmark.md` matches the current gate numbers and limitations.
- `docs/comparison-table.md` matches the current comparator statuses, including `CodeGraphContext`.
- `docs/demo.md` uses real CLI output, not invented snippets.
- `package.json` is the source of truth for the npm package version,
  description, and keywords.
- `npm pack --dry-run --json` succeeds and shows the files that will actually
  ship to npm.
- The local ContextBench case study is described as a 20-task, 500-check
  practical case study: 400 retrieval/resource checks plus 100 checks with token
  counters. The retrieval view has 387 checks scored and 13 retained Repowise
  checks with no usable context, not a winner claim.
- If token cost is mentioned, use the exact boundary: the 100 token-metered
  checks completed 100/100 and capture the model cost of reading returned
  context. They do not prove token savings in a patch workflow and do not
  calculate the model-provider bill. Separate Codex orchestration/meta-cost is
  about 3.33B total tokens, 3.318B input, 3.179B cached input, 11.3M output,
  and 3.27M reasoning output; it is not a per-tool runtime score.

## Public Surfaces To Sync

- `README.md`
- `package.json`
- `docs/capabilities.md`
- `docs/client-setup.md`
- `docs/cli.md`
- npm package description and keywords derived from `package.json`
- live npm registry metadata after publish, checked with
  `npm view codebase-context version description keywords repository.url homepage --json`
- live GitHub repository metadata before announcement, checked with
  `gh repo view PatrickSys/codebase-context --json description,homepageUrl,repositoryTopics`

## Owner Review Bundle

Review these together before deciding whether to publish the narrow practical
case study:

- Product and setup copy: `README.md`, `package.json`,
  `docs/client-setup.md`, `docs/capabilities.md`, `docs/cli.md`, and
  `docs/demo.md`.
- Benchmark copy and evidence: `docs/benchmark.md`,
  `docs/comparison-table.md`, `results/contextbench-engineering-note-summary.json`,
  and the current `CHANGELOG.md` Unreleased block.
- The checked-in ContextBench summary is a repo artifact, not an npm package
  file. The packaged README should point benchmark readers to shipped files or
  stable GitHub URLs.
- Release safety: `.github/workflows/publish-npm-on-release.yml`,
  `.github/workflows/release-please.yml`, and this checklist.
- Guard tests: `tests/proof-truth-surfaces.test.ts`,
  `tests/contextbench-publishable-methodology.test.ts`,
  `tests/release-truth-surfaces.test.ts`, and
  `tests/mcp-client-templates.test.ts`.

Keep local-only material out of the review bundle and out of commits: goal
files, `.planning/**`, benchmark run directories, screenshots, logs, temp
files, and unpublished local scratch output.

## Desired Live Metadata

- npm package version, description, and keywords should match `package.json`.
- GitHub repository description should use the same claim-safe wording as the
  package description:
  `Local code context for AI coding agents: semantic search, team conventions, patterns, and memory through MCP.`
- GitHub topics may describe shipped surfaces such as `mcp`, `mcp-server`,
  `semantic-search`, `hybrid-search`, `local-first`, `privacy-first`,
  `team-conventions`, `team-memory`, `ai-agents`, and `context-engineering`.
- GitHub and npm metadata must not claim fewer tokens, faster development,
  better output, benchmark wins, research-paper benchmark proof, or
  patch-quality impact.

## Required Truth Checks

- If the gate is `pending_evidence`, say so explicitly.
- If the raw-Claude baseline still has `averageFirstRelevantHit: null`, say the baseline remains `pending_evidence`.
- If `codebase-memory-mcp` still reads comparator artifact `ok` but gate `failed`, say so explicitly.
- If any comparator is `setup_failed`, say so explicitly.
- For the older discovery gate, do not claim benchmark wins against `raw Claude Code`, `GrepAI`, `jCodeMunch`, `codebase-memory-mcp`, or `CodeGraphContext` without real metrics in `results/comparator-evidence.json`. The separate local ContextBench case study must use its checked-in summary boundary instead.
- Do not claim implementation quality from the older discovery gate.
- Do not turn the older discovery gate into relaunch-release, risky-edit, or patch-quality proof language.
- Do not mix the newer local ContextBench case study into the older discovery gate. The ContextBench case study currently allows only a narrow practical case-study framing.
- If local ContextBench is mentioned, also mention the blockers: the 500-check view combines local evidence sets, retrieval-overlap plus context-consumption token metering only, patch-quality/token-savings/model-provider costs not measured, Repowise checks with no usable context, and no public winner claim.
- Do not let the Codex orchestration/meta-token total imply per-tool token savings. It is the cost of benchmark work, not a tool score.
- Say the publication decision plainly: current material is only a narrow practical case study; a repeat/stability study is required for any winner, leaderboard, research-paper benchmark, or resource-efficiency claim.
- Do not omit the current reranker fallback limitation if the proof run still shows `Protobuf parsing failed`.

## Before Registry Or README Updates

- Re-run the four proof commands from `docs/benchmark.md` if the evidence artifacts look stale.
- Reconfirm that `results/gate-evaluation.json` still reports `claimAllowed: false` before writing relaunch copy.
- Reconfirm that `results/gate-evaluation.json` still reports `suiteStatus: complete`.
- Reconfirm that `CodeGraphContext` remains represented in the comparison table even if the comparator still fails.
- Reconfirm that local ContextBench wording still says the case study does not name a winner.
- Reconfirm that release copy says "practical case study" before it says "benchmark".
- Before announcing npm metadata, run
  `npm view codebase-context version description keywords repository.url homepage --json`.
  Do not announce npm registry copy as aligned until the live registry reports
  the same version, description, and keywords as `package.json`.
- Before announcing GitHub metadata, run
  `gh repo view PatrickSys/codebase-context --json description,homepageUrl,repositoryTopics`.
  Do not announce the GitHub repo surface as aligned while the live description
  still makes token-savings, speed, better-output, or winner-style claims that
  the current evidence does not support.
- Before publishing, run `npm pack --dry-run --json` and inspect the package
  preview. Confirm it includes `README.md`, `docs/cli.md`,
  `docs/capabilities.md`, `docs/client-setup.md`, `templates`, `grammars`,
  and `dist`. Confirm benchmark links in the packaged README either point to
  shipped files or stable GitHub URLs.
- Before publishing from a release tag, confirm the tag is exactly
  `v${package.json version}`. The publish workflows should fail closed if the
  tag and package version disagree.

## Owner-Approved Launch Sequence

Do not start this sequence until the owner explicitly approves release/publish
work in the current session.

1. Re-run the focused proof suite:
   `pnpm exec vitest run tests/proof-truth-surfaces.test.ts tests/contextbench-publishable-methodology.test.ts tests/release-truth-surfaces.test.ts tests/mcp-client-templates.test.ts`.
2. Preview the npm package:
   `npm pack --dry-run --json`.
3. Check the live npm registry before publish:
   `npm view codebase-context version description keywords repository.url homepage --json`.
   It is expected to remain stale before publish; do not announce alignment yet.
4. Check live GitHub metadata:
   `gh repo view PatrickSys/codebase-context --json description,homepageUrl,repositoryTopics`.
   Do not announce alignment while the description still claims fewer tokens,
   less time, better output, benchmark wins, research-paper benchmark proof, or
   patch-quality impact.
5. If the owner approves metadata changes, update the live GitHub description to:
   `Local code context for AI coding agents: semantic search, team conventions, patterns, and memory through MCP.`
6. Publish only from a release tag that exactly matches `v${package.json version}`.
   The workflows should fail closed if the tag and package version disagree.
7. After publish, rerun the live npm and GitHub metadata checks. Announce
   metadata alignment only after both live surfaces match the checked-in target.

## Release Stop Conditions

- Stop if the proof docs drift from the JSON artifacts.
- Stop if public copy implies a pass while the gate still says `pending_evidence`.
- Stop if registry metadata still uses broader positioning than the checked evidence can support.
- Stop if the live GitHub repo description or topics still use broader
  positioning than the checked evidence can support.
- Stop if registry metadata presents setup/readiness failures as competitor quality losses.
- Stop if the live npm registry still reports an older version, description, or
  keyword set after the release/publish step.
- Stop if the npm package preview omits README, shipped setup docs, templates,
  grammars, or dist output.
- Stop if the release tag does not match the checked-in package version.
- Stop if the copy implies a research-paper or repeated-stability benchmark already exists.
