BEWARE: AI-GENERATED MARKDOWN FILE, DO NOT BLINDLY TRUST IT

# New Start: AI-Ready Codebase Context

Date: 2026-05-09
Status: restart handoff, not a committed PRD
Audience: future human or agent reconstructing a real PRD, roadmap, and benchmark plan

## Side Idea Implementation Handoff

Status on 2026-05-09: this repo now contains a Track A implementation spike for the **AI Context Package** idea. Treat it as a side idea and donor snapshot, not as a clean continuation of the main `codebase-context` roadmap.

The backup branch for this side idea is:

- `backup-ai-context-package-side-idea-2026-05-09`

Why this is a side idea:

- The product wedge is different from the current semantic-search/MCP product. The clean public story is "ship AI-usable context with your library", not "better code search".
- Keeping it in this repo creates inherited friction: existing benchmark gates, semantic-search positioning, MCP setup assumptions, and unrelated dirty work.
- The better long-term shape is likely a new small package/repo, with this repo treated as prior art and later as the optional live-MCP lane.

What exists in the spike:

- `src/package-context/`: generic local package-context builder, previewer, checker, and types.
- `src/cli-package.ts`: `package build`, `package preview`, and `package check` CLI surface.
- `tests/fixtures/ai-context-package-*`: frozen non-claim-bearing eval fixtures with 24 tasks across `ignore`, `uuid`, and `fuse.js`.
- `tests/package-context.test.ts` and `tests/ai-context-package-fixtures.test.ts`: focused coverage for package build/check and fixture integrity.
- `results/ai-context-package-sample/`: generated sample package for `ignore@5.3.2`.
- `results/ai-context-package-benchmark-report.json`: honest report saying no agent-performance claims are allowed yet.
- README, capabilities, CLI docs, changelog, `package.json`, `src/cli.ts`, `src/index.ts`, and `src/lib.ts` were edited to expose the side idea from this repo.

Verification before this handoff:

- `rtk pnpm run type-check`: passed.
- `rtk pnpm run build`: passed.
- `rtk pnpm test -- tests/package-context.test.ts tests/ai-context-package-fixtures.test.ts tests/cli.test.ts tests/cli-entrypoint-runtime.test.ts tests/proof-truth-surfaces.test.ts`: passed, 5 files / 19 tests.
- `rtk pnpm run lint`: passed with existing `no-console` warnings in older CLI files.
- `rtk node dist/index.js package preview results/ai-context-package-sample`: passed.
- `rtk node dist/index.js package check results/ai-context-package-sample --json`: passed.
- Full `rtk pnpm test` did not complete within 180 seconds and showed unrelated global release/benchmark failures before timeout.

Important containment notes:

- Do not treat the backup branch as a clean PR. It is a snapshot of the side idea for recovery and extraction.
- Do not publish public outcome claims from this spike. The fixtures are frozen but no claim-bearing lane run exists.
- Do not delete the in-repo spike unless a separate extraction branch/repo has been reviewed.
- If extracting, start with the small CLI/package artifact first. Leave live MCP, semantic retrieval, and agent outcome benchmarking as Track B.

This document is deliberately direct. It captures the product picture after six months of work, the reason the current framing struggled, and two restart options:

1. V1: **AI Context Package**: a low-friction export format for libraries, SDKs, and component systems so AI agents can use them correctly.
2. V2: **Evidence Packet Context Engine**: a better `codebase-context` that returns task-conditioned, source-backed orientation packets before an agent edits.

Both ideas share the same engine: local-first indexing, structural code facts, docs/tests/examples as evidence, confidence labels, and agent-first evaluation.

## Evidence Labels

- `[confirmed-local]`: verified from this repo's files or benchmark docs.
- `[research-observed]`: observed from public docs, GitHub README, paper, or benchmark description during research.
- `[vendor-claim]`: project/site claim that should not be repeated publicly as fact without reproduction.
- `[inference]`: reasoned product conclusion from multiple signals.
- `[hypothesis]`: idea worth testing, not yet proven.

## Current Situation

The AI SWE landscape in 2025-2026 is no longer mainly about "can the model write code?" It is about whether an agent can keep useful context in budget, avoid wandering, retrieve the right files, and make edits that fit the repo. Agentic coding tools have become more capable, but context windows, session limits, token budgets, provider costs, and tool-call bloat remain practical constraints. The more effective tools appear to spend serious effort on context thrift: search first, read selectively, compact state, use repo maps, use subagents, index code, and keep tool output small.

The original `codebase-context` instinct was correct: agents fail when they edit with low-quality context, stale assumptions, generic examples, or random files. The product was trying to make agents more deterministic, smaller in their edits, more repo-aware, and less reactive.

The failure mode was not that the problem was fake. The failure mode was that the public wedge was too broad and too hard to prove quickly. "Better codebase context" sounds useful but competes with native agent search, Cursor/Windsurf/Sourcegraph-style indexing, Repomix/Gitingest-style exports, graph-RAG tools, and local MCP tools. Without a tight benchmark and an obvious first-use story, the product reads as "another code search MCP" even if the deeper philosophy is better.

## What Failed

1. **The story was too large.** It included repo search, AST chunks, conventions, memory, MCP, benchmarks, context budgets, docs, tests, and agent discipline. That is internally coherent, but externally hard to grasp.

2. **The first value moment had too much friction.** If users must install an MCP, index a repo, understand tools, and trust a benchmark before seeing value, the funnel is weak. Repomix and Gitingest win attention because the first value is obvious: one command gives an AI-readable artifact.

3. **Novelty was not legible.** Graph search, repo maps, embeddings, and MCP servers already exist. The novel part was not "code search"; it was "source-backed context discipline that tells the agent what is safe to use, what is missing, and when not to claim readiness."

4. **Proof was not finished.** Local benchmark docs currently do not support strong public claims. The repo's benchmark framing says broad win claims remain blocked until better evidence exists. `[confirmed-local]`

5. **Evaluation risk was high.** Retrieval metrics alone are attributable but not what buyers care about. Agent task success is what people care about but harder, slower, and noisier. The right answer is both: retrieval/localization as diagnostic metrics, downstream agent outcome as public proof.

6. **Local-first constraints are real.** The repo requires zero-infra, privacy-first, CPU-only defaults, small download footprint, and no required cloud service. These constraints are good, but they rule out many easy "just use a graph DB/embedding service/GPU model" answers.

7. **Docs/tests/business reasons were under-modeled.** Code alone cannot explain intended behavior. Tests, Storybook stories, examples, migration docs, changelog entries, and ADR-like notes often encode the actual contract.

## What Was Right

1. Agents need **task-relevant context**, not bigger context.
2. Search should be **evidence-bearing**, not just semantically plausible.
3. Tools should return **small, inspectable outputs**.
4. "Ready to edit" should be a **claim with evidence**, not a default posture.
5. Docs, tests, examples, and stories should be linked to code as **behavior locks** and **usage contracts**.
6. Benchmarks must report **failures, setup friction, false-ready behavior, and cost**, not one flattering score.
7. The core must remain **generic**. Angular, Storybook, React, FastAPI, etc. belong in extractors or adapters, not core types.

## Research Snapshot

### Product And Repo Tools

| Tool | Observed signal | Product lesson |
| --- | --- | --- |
| Aider repo map | Budgeted in-chat map of files, classes, functions, signatures, and relevance-ranked repo structure. `[research-observed]` https://aider.chat/docs/repomap.html | Steal the token-budgeted symbol map. Make it standalone and evidence-linked. |
| Repomix | Packs a local or remote repo into AI-readable XML/Markdown/JSON/plain output, with token counts, tree, compression, secret scanning, and MCP mode. `[research-observed]` https://github.com/yamadashy/repomix | Steal the dead-simple export and inspectable artifact. Reject dump-everything as default. |
| Gitingest | Converts a repo into a prompt-friendly summary/tree/content digest, including simple URL ergonomics. `[research-observed]` https://github.com/coderamp-labs/gitingest | Steal the obvious first-use story. Add structure, provenance, and task-specific retrieval. |
| CodeGraphContext | Multi-language code graph with CLI/MCP relationship queries and graph DB-backed setup. `[research-observed]` https://github.com/CodeGraphContext/CodeGraphContext | Steal graph query vocabulary and examples. Reject mandatory graph DB friction. |
| codebase-memory-mcp | Static-binary MCP graph backend, SQLite artifact, FTS/BM25/semantic/graph queries. Strong performance claims are vendor claims. `[research-observed]` `[vendor-claim]` https://github.com/DeusData/codebase-memory-mcp | Steal CLI/MCP parity, local graph, schema tools, boring install/uninstall. Do not repeat percentage claims without reproduction. |
| GrepAI | Local semantic search/call graph daemon, compact formats, MCP/JSON output, Ollama/OpenAI embeddings. `[research-observed]` https://github.com/yoanbernabeu/grepai | Steal compact output and workspace model. Reject required embedding provider for default path. |
| Probe / CocoIndex / Octocode | 2026-ish code context/search/AST/MCP projects with lower-friction or structural search positioning. `[research-observed]` https://github.com/probelabs/probe https://github.com/cocoindex-io/cocoindex-code https://github.com/Muvon/octocode | Watch, but do not chase every graph-RAG clone. |
| Graphiti / Microsoft GraphRAG | Temporal/provenance-rich knowledge graph and GraphRAG artifact discipline. `[research-observed]` https://github.com/getzep/graphiti https://microsoft.github.io/graphrag/index/overview/ | Steal provenance, invalidation, and artifact-table discipline. Reject LLM-generated KG as MVP core. |

### Papers And Benchmarks

| Source | Signal | Product lesson |
| --- | --- | --- |
| ContextBench | Process-oriented code context benchmark with gold context and retrieval efficiency metrics. `[research-observed]` https://arxiv.org/abs/2602.05892 | Closest fit. Measure whether agents retrieve and use the right context, not just final test pass. |
| SWE-ContextBench / repository memory work | Selected summaries/history can help, unfiltered memory can hurt. `[research-observed]` https://arxiv.org/abs/2602.08316 https://www.microsoft.com/en-us/research/publication/improving-code-localization-with-repository-memory/ | Memory must be retrieved, scoped, and source-linked, not pasted wholesale. |
| CodeRAG-Bench | Code RAG can retrieve many irrelevant things, and generation may fail to use retrieved context. `[research-observed]` https://aclanthology.org/2025.findings-naacl.176/ | Do not optimize recall alone. Track used vs merely retrieved context. |
| Lost in the Middle | Long contexts can bury relevant information. `[research-observed]` https://arxiv.org/abs/2307.03172 | Context packing/order matters. "More context" is not a strategy. |
| Codebase-Memory / RIG / ReCUBE / GraphCodeAgent / CodeGRAG | Structural graphs and code memory are promising when grounded in parser/build/test evidence and retrieved selectively. `[research-observed]` https://arxiv.org/abs/2603.27277 https://arxiv.org/abs/2601.10112 https://arxiv.org/abs/2603.25770 https://arxiv.org/abs/2504.10046 https://arxiv.org/abs/2405.02355 | Use deterministic graphs as an evidence layer. Do not treat graph existence as proof of agent improvement. |
| SWE-bench Pro / OpenAI SWE-bench Verified critique | Downstream patch benchmarks matter, but older public suites can be contaminated or flawed. `[research-observed]` https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ https://arxiv.org/abs/2509.16941 | Use downstream patch success as secondary proof, with local held-out tasks and transparent failures. |
| Evaluating AGENTS.md | Broad context files can reduce success and increase cost when they add unnecessary constraints. `[research-observed]` https://arxiv.org/abs/2602.11988 | Do not prepend static guidance by default. Select the minimum relevant rule/context. |

## Recommended Reset

The strongest restart is not "GraphRAG for code." That category is crowded, expensive to prove, and often overclaims. The stronger reset is:

> A local, evidence-backed context compiler for AI agents.

It has two surfaces:

1. **Export surface:** produce AI-ready context packages that humans can review and agents can consume.
2. **Live surface:** answer task-specific questions with compact, source-backed evidence packets.

The export surface is the sharper V1. The live surface is the better version of the original product.

## V1 Idea: AI Context Package

### One-Liner

An **AI Context Package** lets maintainers publish an inspectable, versioned usage contract for a library, SDK, package, or component system so coding agents use the right APIs, examples, tests, and constraints before guessing.

### Why This Is A Better Wedge

This is easier to understand than "better codebase search." It speaks to a concrete pain:

- "People's agents keep using my library wrong."
- "My component library has Storybook, tests, examples, docs, and API exports, but agents still hallucinate props."
- "My SDK has migrations and deprecations that README scraping misses."
- "I want to ship context for AI users the same way I ship types/docs/examples."

The output is an artifact. That matters. It can be committed, reviewed, diffed, published, attached to npm packages, referenced from docs, or passed to an agent without MCP setup.

### Target Users

Primary:

- Open-source library maintainers.
- Internal platform/library teams.
- SDK authors.
- UI component library/design system maintainers.
- Teams with Storybook, examples, tests, and docs that encode usage rules.

Secondary:

- Developers consuming unfamiliar packages through agents.
- Agent tool vendors that want a standard package-context format.

### Job To Be Done

When a user asks an AI agent to use a library, the maintainer wants the agent to see the actual usage contract: install/import paths, public APIs, canonical examples, version constraints, behavior tests, deprecations, migration notes, and common pitfalls. The agent should use that context before crawling random source files or relying on stale model memory.

### Product Promise

Do not promise "agents always use your library correctly."

Promise:

> Generate a compact, reviewable, source-linked context package that gives AI agents the best available local evidence for how this package should be used.

### First Command

Possible command shape:

```bash
npx codebase-context package build ./packages/ui --out .ai-context/package
```

Secondary commands:

```bash
npx codebase-context package preview .ai-context/package
npx codebase-context package check .ai-context/package
npx codebase-context package explain Button
npx codebase-context package diff --since v1.8.0
```

If a rename is acceptable later, `ai-context build` is the cleaner public name. Keep `codebase-context` as the engine until naming is decided.

### Artifact Shape

The package should be human-readable first, structured second, and compact third. Avoid an opaque binary graph as the default artifact.

```text
my-library.context/
  manifest.json
  README.md
  graph/
    artifacts.jsonl
    symbols.jsonl
    edges.jsonl
    public-surface.jsonl
  packets/
    overview.json
    api-surface.json
    examples.json
    testing.json
    decisions.json
    migrations.json
    storybook.json
  indexes/
    lexical.json
    embeddings/              # optional, never required
  provenance/
    source-manifest.json
    hashes.json
    extractor-report.json
```

### Generic Schema

Core must stay framework-agnostic.

Suggested generic kinds:

```text
ArtifactKind:
  source
  test
  documentation
  example
  story
  decision
  package_manifest
  api_surface
  changelog
  migration
  generated_context

EdgeKind:
  defines
  exports
  imports
  references
  calls_syntactic
  tests
  documents
  demonstrates
  decides
  deprecates
  migrates
  mentions
  changed_with
```

Framework details go into namespaced metadata:

```json
{
  "artifactKind": "story",
  "metadata": {
    "storybook": {
      "title": "Components/Button",
      "args": ["variant", "size", "disabled"]
    }
  }
}
```

No core interface should add `storybookTitle`, `angularSignal`, `reactHook`, or similar framework-specific fields.

### How Storybook, Tests, Docs, And Code Marry

The central idea is not "parse Storybook." It is "connect usage evidence to public surface."

For a UI component library:

- Source defines `Button`.
- Package exports `Button`.
- Storybook story demonstrates `Button` with named args.
- Tests lock expected behavior.
- Docs explain usage constraints.
- Changelog/migrations explain version changes.

The context package should let an agent ask:

- What is the public import path?
- Which examples are canonical?
- Which props/options are demonstrated but not necessarily public?
- Which tests prove behavior?
- What should not be used because it is internal/deprecated?
- What verification command should run after using this component?

This is generic. For an Angular SDK, Storybook might become docs/examples/tests. For a Python package, public API docs and tests are the usage evidence. For a Go module, examples and exported symbols carry the same role.

### V1 MVP Scope

Support one ecosystem well first, but keep the data model generic.

Recommended MVP:

- npm/TypeScript packages.
- Package manifest and exports discovery.
- Public symbol extraction from source and declaration files when available.
- README/docs/examples/test/story files as evidence artifacts.
- Storybook extraction if config is present, as an optional extractor.
- Reviewable package artifact.
- `package check` stale-reference and provenance check.
- `package preview` human-readable summary.
- Agent consumption prompt/card.

Non-goals:

- No hosted registry.
- No required MCP.
- No cloud embeddings.
- No binary graph default.
- No universal framework analyzer in V1.
- No benchmark win claims before frozen eval.

### PRD Handoff For V1

Problem:

Agents frequently misuse libraries because they rely on stale model memory, random source files, incomplete README excerpts, or examples that are not the canonical usage path. Maintainers have no standard way to ship AI-usable context with their package.

Goals:

- Generate an AI-ready, reviewable context package from a library repo.
- Connect public API, examples, tests, docs, migrations, and stories through source-backed edges.
- Keep the artifact small enough for agents to inspect.
- Make stale or unsupported generated claims visible.
- Provide a benchmark harness that compares agent behavior with and without the package.

Non-goals:

- Do not solve arbitrary repo editing in V1.
- Do not require MCP setup.
- Do not claim the generated package is authoritative without maintainer review.
- Do not optimize for every language/framework before proving one.

User stories:

- As a library maintainer, I can run one command and get a context package that summarizes public APIs and canonical examples.
- As a maintainer, I can review the generated package and see exactly which files support each claim.
- As a maintainer, I can run `package check` in CI to catch stale links or missing provenance.
- As an agent user, I can give the package to my coding agent and ask it to use the library without guessing import paths or props.
- As a benchmark author, I can compare README-only, raw repo search, and context-package lanes on the same tasks.

Acceptance criteria:

- The artifact has a manifest, public surface, examples, tests, docs, and provenance.
- Every generated recommendation has file-level provenance.
- Unsupported or low-confidence sections are labeled.
- Artifact generation runs locally through `npx`.
- No API key is required.
- The artifact is inspectable in a text editor.
- `package check` fails on broken source references.
- The benchmark can run at least 20 frozen tasks across at least 2 packages before public claims.

Open questions:

- Should the artifact be committed to the repo, published as package metadata, or generated on demand?
- Should `README.md` inside the artifact be optimized for humans, agents, or both?
- Should Storybook support be V1 or V1.1?
- What is the smallest public schema that can attract adoption without becoming a standardization project?
- Is the brand `codebase-context`, `ai-context`, or something else?

### V1 Technical Architecture

Pipeline:

1. Discover package root and manifest.
2. Build a deterministic source inventory.
3. Extract public surface from exports, declarations, source symbols, and docs.
4. Extract evidence artifacts: docs, examples, stories, tests, migrations, changelog.
5. Link artifacts through deterministic edges.
6. Generate compact packets.
7. Validate provenance and size budget.
8. Emit preview and machine-readable package.

Core modules:

- `inventory`: files, ignore rules, hashes.
- `extractors`: language/framework/package-specific plugins.
- `graph`: generic artifacts, symbols, edges.
- `packets`: compact agent-facing summaries.
- `provenance`: source spans, confidence, hash checks.
- `preview`: human-readable output.
- `check`: validation gates.
- `harness`: agent-lane evaluation.

Confidence:

- `high`: parser/build/export evidence plus docs or tests agree.
- `medium`: one strong source, such as exported symbol plus canonical example.
- `low`: docs mention or heuristic match without structural confirmation.
- `unsupported`: generated claim lacks evidence and should not be included as guidance.

### V1 Agent Harness

The harness must test behavior, not self-rated usefulness.

Lanes:

| Lane | Agent gets | Purpose |
| --- | --- | --- |
| `raw-native` | Native file search/read only | Baseline for unaided agent exploration. |
| `readme-only` | README/docs only | Tests current common behavior. |
| `exported-context-package` | Static context package first | Tests low-friction artifact value. |
| `live-codebase-context-mcp` | Optional live tools | Tests whether MCP adds enough value over export. |

Task categories:

- Correct import/API usage.
- Component prop/option usage.
- Avoiding internal/deprecated API.
- Selecting canonical example.
- Finding required verification command.
- Migrating old usage to new usage.
- Negative tasks where the correct answer is "not enough evidence."

Required structured agent answer:

```json
{
  "answer": "short grounded answer",
  "confidence": "low|medium|high",
  "evidence": [
    {
      "file": "repo-relative path",
      "lineRange": { "start": 1, "end": 3 },
      "reason": "why this proves it"
    }
  ],
  "filesReferenced": ["repo-relative path"],
  "symbolsReferenced": ["optional symbol"],
  "unsupportedClaims": [],
  "readyToEdit": false
}
```

Metrics:

- Public API correctness.
- Example correctness.
- Hallucinated API/prop rate.
- Evidence correctness.
- Context precision/recall/F1 at file/symbol/span level.
- False-ready rate.
- Tool calls.
- Gross input tokens.
- Cached input tokens.
- Tool-output tokens.
- Output/reasoning tokens where available.
- Cost per successful task.
- Setup/indexing time reported separately.

Anti-gaming rules:

- Freeze tasks, expected context, prompts, lane cards, budgets, scorer, and report shape before implementation.
- Source changes and benchmark changes cannot land in the same comparison step.
- No task-id, repo-name, filename, or phrase-specific boosts.
- No expected-result edits after seeing outputs except append-only factual errata.
- Failed, timed-out, invalid-schema, and setup-failed rows stay visible.
- Gold context is never shown to the solver agent.
- LLM judge is diagnostic only unless constrained to predefined facts/evidence checks.

Artifacts per run:

```text
run-manifest.jsonl
prompt.txt
lane-card.json
setup-index.json
raw-trace.json
structured-answer.json
trajectory.json
score.json
cost.json
artifact-hashes.json
```

### V1 Proof Plan

Week 1:

- Freeze 20-30 tasks before implementation.
- Pick at least 2 packages, ideally 3:
  - one UI component library with stories/examples,
  - one SDK/library with docs and tests,
  - one utility package.
- Define gold context and negative labels.

Week 2:

- Build the first exporter over existing indexing/search capabilities.
- Emit manifest, public surface, examples, tests, docs, provenance.
- Add package preview and check.

Week 3:

- Run harness lanes: `raw-native`, `readme-only`, `exported-context-package`.
- Do not tune fixtures after seeing output.
- Capture failures as first-class findings.

Week 4:

- Publish only narrow claims:
  - "On this frozen eval, context package reduced X failure type."
  - "Here are failures."
  - "Here is setup time and artifact size."
- Do not claim general agent improvement until replicated across more repos/languages.

## V2 Idea: Evidence Packet Context Engine

### One-Liner

A better `codebase-context` should return a compact, task-conditioned evidence packet that tells an agent where to start, what example to imitate, what files are likely relevant, what tests/docs constrain the edit, and whether the evidence is strong enough to edit.

### Why This Is The Better Version Of The Original

The original product can still exist, but the first moment must change. Instead of exposing many tools and hoping the agent uses them well, the tool should answer:

> "For this task, what context would a disciplined senior engineer read first, and what is still uncertain?"

That is different from search. Search returns hits. An evidence packet returns orientation:

- owning area,
- likely edit targets,
- safe examples,
- related tests,
- docs/decisions,
- call/reference edges,
- verification minimum,
- risk/gaps,
- ready-to-edit flag.

### First Command

```bash
npx codebase-context focus "Add CSV export to the invoices table"
```

Possible output:

```json
{
  "ready": false,
  "confidence": "medium",
  "owningArea": "billing/invoices",
  "topTargets": [
    { "file": "src/features/invoices/table.tsx", "reason": "renders table actions" }
  ],
  "safeExemplars": [
    { "file": "src/features/payments/export.ts", "reason": "similar export flow" }
  ],
  "tests": [
    { "file": "tests/invoices-table.test.ts", "reason": "covers table actions" }
  ],
  "docs": [],
  "gaps": [
    "No existing CSV export helper found; inspect serialization conventions before editing."
  ],
  "nextReads": [
    "src/features/invoices/table.tsx",
    "src/features/payments/export.ts",
    "tests/invoices-table.test.ts"
  ]
}
```

This is low friction because it works without MCP. MCP becomes an adapter, not the core product.

### Command Surface

Keep the surface small:

```bash
npx codebase-context init
npx codebase-context map
npx codebase-context focus "<task>"
npx codebase-context search "<query>"
npx codebase-context refs <symbol-or-file>
npx codebase-context explain <file-or-symbol>
npx codebase-context check
npx codebase-context mcp
```

Do not add a dozen clever commands before `focus` is excellent.

### V2 PRD Handoff

Problem:

Agents waste context and make low-quality edits because they do unguided search/read loops. Native agent tools are strong but inconsistent. They often find a plausible file before finding the correct owner, nearby conventions, tests, or design rationale.

Goals:

- Give agents a one-command task packet before editing.
- Reduce wrong-file exploration and false-ready edits.
- Surface uncertainty explicitly.
- Work locally with no required cloud, Docker, GPU, or graph DB.
- Keep output under strict token budgets.
- Support CLI first, MCP second.

Non-goals:

- No hosted workspace memory.
- No enterprise policy/control plane.
- No mandatory embeddings.
- No full automated coding agent.
- No universal claim that it improves all tasks.

User stories:

- As a developer, I can run `focus "<task>"` and get the first files/examples/tests I should inspect.
- As an agent, I can use `focus` to decide whether I have enough evidence to edit.
- As a maintainer, I can see why the tool thinks a file is relevant.
- As a benchmarker, I can compare `focus` against raw search on frozen tasks.

Acceptance criteria:

- `focus` returns `ready`, `confidence`, `topTargets`, `safeExemplars`, `tests`, `docs`, `gaps`, and `nextReads`.
- Every target has a reason and source evidence.
- The packet stays within a configured token budget.
- Low-confidence output does not claim readiness.
- CLI output is usable without MCP.
- MCP exposes the same capability, not a divergent behavior.
- At least two non-TypeScript codebases are included in smoke evaluation before public claims.

### V2 Architecture

Layered local retrieval:

1. Lexical search: exact names, paths, strings, comments.
2. Symbol index: definitions, exports, references, imports.
3. Structural graph: calls, tests, docs, examples, ownership clusters.
4. Recency/history memory: changed-with edges and prior task notes where available.
5. Optional embeddings: opt-in, never default requirement.
6. Optional LLM summarization: only after evidence is selected.

Staged retrieval:

1. Parse the task into likely nouns/actions/symbols.
2. Run cheap lexical/symbol search.
3. Expand through graph edges only when justified.
4. Find safe exemplars similar to target.
5. Attach tests/docs/examples.
6. Score evidence and set `ready`.
7. Return compact packet plus next reads.

Important design rule:

Do not return a static repo map for every query. Static context can become noise. The packet must be task-conditioned.

### V2 Novelty

The novel part is not "we have a graph." The novel part is:

- task-conditioned evidence packets,
- explicit false-ready prevention,
- source-linked confidence,
- docs/tests/examples as behavior locks,
- local-first CLI/MCP parity,
- agent harness proving context use, not just search quality.

### V2 Evaluation

Use three first-class lanes:

| Lane | What agent gets | Purpose |
| --- | --- | --- |
| `raw-native` | Native read/search only | Baseline. |
| `exported-context-package` | Static package/context export | Tests low-friction artifact. |
| `live-codebase-context-mcp` | Live `focus/search/refs/map` tools | Tests full product. |

Task set:

- Minimum 20 tasks, preferably 24-30.
- Minimum 2 repos, preferably 3.
- Categories:
  - orientation,
  - bug localization,
  - edit target selection,
  - convention imitation,
  - wiring/composition root discovery,
  - testing path discovery,
  - negative/abstain tasks.

Primary metrics:

- `context_recall`,
- `context_precision`,
- `context_f1`,
- `evidence_correctness`,
- `fact_recall`,
- `false_ready_rate`,
- `unsupported_claim_rate`.

Secondary metrics:

- wall time,
- tool calls,
- setup/index time,
- gross input tokens,
- cached input tokens,
- tool-output tokens,
- output/reasoning tokens,
- cost per successful task.

Report these separately. Do not collapse them into one score.

## Knowledge Graph Direction

The graph should be deterministic and provenance-first.

Use graph records for:

- files/artifacts,
- symbols,
- public API entries,
- exports/imports,
- references,
- syntactic calls where available,
- tests,
- docs,
- examples,
- stories,
- migrations,
- decisions,
- changed-with history.

Do not use LLM-generated architecture claims as graph truth. LLM summaries can be optional overlays with confidence and provenance.

### Graph Queries That Matter

For V1:

- "What public APIs does this package expose?"
- "Which examples demonstrate this API?"
- "Which tests lock this behavior?"
- "Which docs mention this symbol?"
- "Which APIs are deprecated or migrated?"
- "Which files support this generated recommendation?"

For V2:

- "What area owns this task?"
- "What file is the safest edit target?"
- "What nearby code should be imitated?"
- "Which tests should protect the change?"
- "What documentation or decision explains the behavior?"
- "What evidence is missing?"

## Agent Harness Thingies

This section exists so a future PRD can be reconstructed without inventing eval structure from scratch.

### Fixture Files

```text
tests/fixtures/context-harness/
  task-manifest.json
  gold-context.jsonl
  gold-facts.jsonl
  gold-process.jsonl
  lane-tool-cards.json
  budget-policy.json
  corrections.json
```

`task-manifest.json`:

- task id,
- repo URL,
- base commit,
- language/ecosystem,
- category,
- prompt,
- prompt hash,
- allowed lanes.

`gold-context.jsonl`:

- required files,
- required symbols,
- required spans,
- acceptable alternates,
- forbidden misleading files.

`gold-facts.jsonl`:

- atomic facts needed for a correct answer.

`gold-process.jsonl`:

- expected process signals, such as "must identify interceptor before service" or "must find canonical Storybook story before using component props."

`lane-tool-cards.json`:

- allowed/disallowed tools per lane.

`budget-policy.json`:

- model,
- timeout,
- context cap,
- answer cap,
- repeat count,
- tool-call cap.

`corrections.json`:

- append-only errata when the original gold label was factually wrong.

### Solver Prompt Contract

Every solver returns strict JSON:

```json
{
  "answer": "short grounded answer",
  "confidence": "low|medium|high",
  "evidence": [
    {
      "file": "repo-relative path",
      "lineRange": { "start": 1, "end": 3 },
      "reason": "why this proves it"
    }
  ],
  "filesReferenced": ["repo-relative path"],
  "symbolsReferenced": ["optional symbol"],
  "unsupportedClaims": [],
  "readyToEdit": false
}
```

### Run Artifacts

```text
results/context-harness/<run-id>/
  run-manifest.jsonl
  prompt.txt
  lane-card.json
  setup-index.json
  raw-trace.json
  structured-answer.json
  trajectory.json
  score.json
  official-evaluator-output.jsonl
  cost.json
  artifact-hashes.json
```

### Scoring

Score with deterministic checks first:

- JSON schema validity.
- Required file hit.
- Required symbol hit.
- Required span overlap.
- Forbidden misleading file penalty.
- Evidence supports answer.
- Required fact recall.
- Unsupported claim count.
- `readyToEdit` agreement.

Use LLM judging only as a diagnostic layer, and only against predefined facts/evidence where possible.

### Comparison Order

1. `raw-native` vs `exported-context-package`.
2. `raw-native` vs `live-codebase-context-mcp`.
3. `exported-context-package` vs `live-codebase-context-mcp`.
4. External competitors only after internal lanes are stable.

This order answers the product question:

- Is the simple export enough?
- Does live MCP add enough value to justify setup?
- Which value should be public first?

## Messaging

Bad messaging:

- "The best codebase search for AI."
- "99% fewer tokens."
- "AI understands your codebase."
- "GraphRAG for code."
- "Make agents deterministic."

Better messaging:

- "Ship AI-usable context with your library."
- "Give agents the examples, tests, and public APIs they should trust."
- "Before your agent edits, give it a source-backed starting packet."
- "Stop paying for agents to rediscover your repo from scratch."
- "Context that says what it knows, what proves it, and what is still missing."

## Track A / Track B

Track A should be one narrow proof.

Recommended Track A:

- AI Context Package for TypeScript/npm packages.
- One command, one artifact, one harness.
- No MCP required.
- 20-30 frozen tasks.
- Two or three packages.
- Honest report.

Track B:

- Live MCP task packet.
- Embeddings.
- Storybook-specific depth.
- Python/Go/Rust.
- Graph visualization.
- Published registry.
- Standardization.
- Competitor benchmark lanes.

Nothing moves from Track B to Track A without an explicit decision.

## PRD Reconstruction Checklist

To turn this into a full PRD, create sections in this order:

1. Problem statement.
2. Target users and non-users.
3. Job-to-be-done.
4. Product promise and non-claims.
5. MVP user journey.
6. Command/API surface.
7. Artifact/schema.
8. Technical architecture.
9. Privacy/local-first constraints.
10. Evaluation plan.
11. Acceptance criteria.
12. Risks and mitigations.
13. Open questions.
14. Milestones.

Do not write implementation code before:

- choosing V1 or V2 as Track A,
- freezing the eval task set,
- deciding whether the artifact should be committed or generated,
- deciding whether the public name stays `codebase-context`.

## Recommended Decision

Choose V1 as Track A:

> Build the AI Context Package first.

Reasoning:

- It is easier to explain.
- It has a visible artifact.
- It avoids MCP setup as the first value moment.
- It gives maintainers ownership.
- It naturally marries source, docs, tests, examples, Storybook, and migrations.
- It creates a benchmark lane that can later prove whether live MCP adds value.

Keep V2 as the engine and next surface:

> Once the package export works, expose the same graph/evidence engine as `focus "<task>"` for arbitrary repos.

This avoids throwing away the original product while giving the restart a cleaner front door.

## What Not To Do Next

- Do not write a public README claiming this improves agent performance.
- Do not build a graph DB dependency before proving the artifact.
- Do not add embeddings as the default path.
- Do not tune eval fixtures after outputs.
- Do not compare against every competitor before internal lanes are stable.
- Do not add broad `.md` docs unless they replace or update an existing source of truth.
- Do not make framework-specific core types.
- Do not let Storybook become the product; it is one extractor.

## Final Working Thesis

The product should stop being framed as "AI codebase search" and become:

> A local context compiler that turns code, docs, examples, tests, and history into small, source-backed packets agents can trust.

V1 packages that context for libraries.

V2 serves that context live for repo tasks.

The proof is not self-evaluation. The proof is whether agents retrieve, cite, and use better context under the same task, model, and budget.
