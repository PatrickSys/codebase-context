# Flagship Product & Autonomous Operating Spec

Status: **active**  
Owner: PatrickSys  
Scope: `codebase-context` as a measurable repository-context system for AI-assisted code review and coding agents  
Primary execution plan: `.planning/ROADMAP.md`

## 1. Mission

Build a public, local-first, vendor-neutral context system that can answer one hard question with evidence:

> Does bounded repository context materially improve an AI reviewer's ability to understand a change and find real issues, at acceptable precision, latency, and context cost?

The project is not successful because it has many analyzers, tools, workflows, or agent integrations. It is successful when an external engineer can reproduce the system, inspect its decisions, run the evidence harness, and see honest results.

## 2. Product Wedge

The flagship wedge is **review context compilation**.

Given a clean committed git change, compile a bounded packet containing:

1. exact base/head identity and diff fingerprint
2. changed files and change statistics
3. deterministic signals extracted from changed lines
4. bounded related repository context
5. relevant repository conventions/patterns
6. retrieval/preflight quality metadata
7. explicit warnings and limits

That packet can then be consumed by any reviewer model or human evaluation harness.

This separates:

- **context compilation** from
- **review reasoning** from
- **evaluation**

That separation is the core architectural principle for the flagship.

## 3. Current Product Contract

The current public review surface is `review-context-v1`.

### Inputs

- local git repository
- clean checked-out `HEAD`
- base git ref
- optional explicit head ref that must resolve to checked-out `HEAD`
- existing or refreshable `codebase-context` index
- explicit query/result/identifier limits

### Outputs

A versioned JSON packet containing:

- exact resolved base/head SHAs
- exact git diff SHA-256
- changed file descriptors
- addition/deletion counts
- rename/binary metadata
- bounded identifiers derived from changed lines
- bounded retrieval queries
- bounded related search results
- search quality / edit preflight metadata when available
- convention/pattern snapshot
- warnings
- all operative limits

### Invariants

The review path MUST:

- use exact resolved commits for diff generation
- fail closed if the working tree is dirty
- fail closed if requested head is not checked-out `HEAD`
- parse git paths safely, including unusual valid filenames
- never silently truncate the diff used for fingerprinting
- bound queries, results, identifiers, and snippets
- never call an LLM during context compilation
- never post review comments
- never represent retrieval confidence as code correctness
- preserve failures/warnings rather than papering over them

## 4. What This Product Is Not

Until evidence passes the relevant gates, this project is **not**:

- a proven AI reviewer
- a replacement for CodeRabbit, Greptile, Copilot review, or similar products
- a claim that semantic/vector retrieval improves review quality
- a cloud platform
- an autonomous pull-request commenter
- a dashboard product
- a framework-specific reviewer
- a place to port abandoned private experiments

`context-kit` is not an authority, benchmark, source of claims, or required dependency. Its historical existence does not validate any design here.

## 5. Evidence Levels

Every public statement must map to one of these levels.

### E0 — Code exists

Evidence:

- implementation present
- unit tests present

Allowed claim:

- "The project implements X."

Not allowed:

- "X works better"
- "X improves review"
- "X is efficient"

### E1 — Reproducible functional behavior

Evidence:

- build passes
- full tests pass
- executable smoke passes
- deterministic envelope invariants verified
- public reproduction instructions exist

Allowed claim:

- "The project can compile a bounded review-context packet from a committed git range."

### E2 — Retrieval value

Evidence:

- frozen public task set before algorithm tuning
- multiple repositories
- multiple languages/frameworks
- fixed limits
- baseline and treatment run under identical scoring
- relevant-file/span retrieval metrics reported with failures

Allowed claim:

- bounded claims about retrieval performance on the frozen evaluation only

### E3 — Reviewer impact

Evidence:

- same reviewer model/harness
- same prompt/budget/timeout
- raw-diff/tool baseline vs review-context treatment
- repeated runs where model nondeterminism matters
- finding recall, precision/false positives, evidence quality, token/context cost, wall time reported separately
- no best-of-N selection

Allowed claim:

- bounded claim that review-context changed measured reviewer performance on the frozen evaluation

### E4 — External usefulness

Evidence can include:

- external users
- independent reproduction
- maintainer adoption
- accepted integrations
- third-party benchmark replication

Only at E4 should broad product-positioning claims become credible.

## 6. Core Hypotheses

### H1 — Changed-line signals can cheaply focus retrieval

A small deterministic signal extractor can produce useful queries from a diff without an LLM.

Kill/fix trigger:

- relevant-file/span coverage is materially worse than simpler path/symbol baselines

### H2 — Bounded repository context can outperform raw diff/repository navigation alone

Adding a bounded `review-context-v1` packet improves review outcomes without unacceptable false positives or context cost.

Kill/fix trigger:

- no meaningful improvement across a frozen multi-repo review set
- improvement is explained only by substantially larger token budgets
- gains disappear outside the development repositories

### H3 — The existing `codebase-context` retrieval stack is good enough to support the wedge

The current search/indexing system can supply relevant review context reliably enough to justify reuse.

Kill/fix trigger:

- retrieval remains the dominant failure mode after a frozen diagnostic evaluation
- simpler baselines match or beat it at lower setup/runtime cost

If H3 fails, do not build more reviewer orchestration. Fix, simplify, or replace the retrieval lane first.

## 7. Architecture

```text
Git repository
    |
    v
Exact committed change envelope
(base/head SHAs, clean tree, exact diff hash)
    |
    v
Deterministic change-signal extraction
(files, stats, identifiers, path fallbacks)
    |
    v
Bounded query planner
(max queries / identifiers)
    |
    v
Repository retrieval
(codebase-context search + quality/preflight metadata)
    |
    +--> conventions / patterns
    |
    v
review-context-v1 packet
    |
    +--> human inspection
    +--> frozen evaluation harness
    +--> model-agnostic reviewer consumer (only after gate)
```

### Architectural boundaries

- Git/diff mechanics must remain independent of model vendors.
- Review-context packet construction must remain usable without an LLM.
- Evaluation must be able to swap reviewer models without rewriting context compilation.
- Framework-specific logic stays in analyzers.
- Core/shared types stay framework-neutral.
- No cloud infrastructure is required for the default product path.

## 8. Metrics

Do not collapse metrics into one vanity score.

### Retrieval metrics

At minimum:

- relevant file recall@k
- relevant span recall@k when ground truth supports it
- precision@k
- context characters/tokens returned
- setup/index time
- retrieval wall time
- failure/abstention rate

### Review metrics

At minimum:

- real finding recall
- false positives / precision
- evidence correctness
- unsupported-claim rate
- reviewer token/context usage
- wall time
- tool/runtime failure rate

### Operational metrics

Track when meaningful:

- cold install size
- cold index time
- incremental refresh time
- peak memory
- packet size

Performance claims require recorded measurements, not intuition.

## 9. Evaluation Integrity

The rules in root `AGENTS.md` remain binding. This spec adds the following review-specific requirements.

### Freeze before tuning

Before changing retrieval/ranking for a claim-bearing evaluation:

1. freeze task IDs
2. freeze repositories and commits
3. freeze ground truth / scorer
4. freeze budgets and limits
5. commit the manifest
6. only then inspect treatment results

### Required baselines

Use the cheapest meaningful baselines first:

1. raw diff only
2. raw diff + repository-native/basic text tools
3. simple changed-file/path/symbol context
4. current `codebase-context` retrieval packet

Do not claim value against an intentionally weak baseline.

### Failure accounting

A setup failure, index failure, timeout, invalid output, missing evidence, or judge failure remains a failure row. It is never silently removed from the denominator.

## 10. Autonomous Agent Operating Model

An agent may manage routine progress without asking for permission for every implementation detail, but it MUST follow this state machine.

### State A — Observe

Read:

1. `AGENTS.md`
2. `.planning/SPEC.md`
3. `.planning/ROADMAP.md`
4. relevant code/tests/docs
5. current PR/CI state

Do not code before identifying the current open gate.

### State B — Classify new information

Every new input is one of:

- **blocker** — CI/test/security/IP/reproducibility failure
- **evidence** — benchmark or external usage result
- **bug** — shipped behavior violates contract
- **hypothesis signal** — suggests a current hypothesis may be right/wrong
- **opportunity** — integration/user/recruiter/maintainer pull
- **idea** — unvalidated feature suggestion
- **noise** — does not materially affect current gate

Only blockers, evidence, bugs, and strong external opportunities can pre-empt the current milestone.

### State C — Route

Priority order:

1. protect privacy/IP/security/reproducibility
2. restore green build/tests
3. satisfy the current roadmap gate
4. collect evidence
5. package/document proven behavior
6. only then expand capability

A new idea never outranks a failing gate.

### State D — Change

Rules:

- one primary hypothesis or defect per PR
- smallest change capable of crossing the current gate
- prefer deleting/simplifying over layering heuristics
- no hidden benchmark-specific branches
- no fixture edits to make output pass
- no broad refactors while evidence is blocked

### State E — Verify

Minimum before merge:

- lint/format
- type-check
- build
- full relevant test suite
- executable smoke for new public binaries
- docs match behavior
- no new unsupported public claim

Evidence-changing work also requires the relevant frozen evaluation.

### State F — Decide

For each milestone, the agent must choose exactly one:

- **PASS** — gate met; advance
- **FIX** — hypothesis still plausible; one bounded repair cycle justified
- **KILL** — evidence says this lane is not worth further work
- **BLOCKED** — external dependency prevents honest conclusion

Do not use "mostly done" as a state.

### State G — Record

After a gate decision:

- update `.planning/ROADMAP.md`
- update claim-bearing docs only if evidence level changed
- record material limitations
- preserve benchmark artifacts/manifests needed for reproduction

## 11. Agent Authority

### May do autonomously

- create branches and PRs
- fix CI failures in current scope
- add tests for current contract
- harden parsing/error handling/reproducibility
- simplify implementation
- add frozen evaluation fixtures before implementation
- run public benchmark/eval infrastructure
- update docs to become more conservative/accurate
- revert its own failing changes
- close/kill a roadmap lane when predefined kill criteria are met

### Must not do autonomously

- publish employer/private code or data
- import private `context-kit` history as validation
- publish broad performance/superiority claims without evidence gate
- add paid/cloud dependencies as required defaults
- weaken frozen ground truth after seeing results
- silently increase treatment budgets relative to baseline
- add an autonomous PR-commenting bot before reviewer-impact evidence passes
- create a dashboard merely to make the project look productized
- change project licensing or ownership policy
- spend money or enable paid external services without explicit owner approval

### Escalate to owner when

- evidence is genuinely ambiguous after one bounded repair cycle
- a decision requires money or credentials
- a privacy/IP boundary is unclear
- two viable architectures have materially different long-term product directions
- external opportunity requires a commitment or public statement

## 12. Scope Control

### Track A — Current

Only work needed to pass the next open gate in `.planning/ROADMAP.md`.

### Track B — Backlog

Potential future work that cannot pre-empt Track A without new evidence.

Examples:

- hosted dashboard
- GitHub App
- Azure DevOps adapter
- autonomous reviewer comments
- queue/worker cloud architecture
- large framework-specific rule packs
- general code-review agent orchestration

Track B items become Track A only when the roadmap explicitly promotes them.

## 13. Product Kill Rules

Stop expanding the review-context wedge if any of these holds after a fair frozen evaluation and one bounded repair cycle:

- simple baselines equal or beat it at materially lower complexity/cost
- relevant-context precision is too low to be useful
- reviewer false positives rise enough to negate recall gains
- benefits require dramatically larger token/context budgets
- gains do not generalize across repositories/languages
- setup/index cost makes realistic use unattractive

A killed hypothesis is a successful engineering result if the evidence is credible and published honestly.

## 14. Definition of Publishable

A milestone is publishable only when a stranger can:

1. understand the problem from public docs
2. install/build the project
3. run the relevant command
4. inspect the versioned output contract
5. run the evidence harness or reproduce the stated functional behavior
6. see limitations and failures
7. distinguish shipped capability from experimental hypothesis

## 15. Current Strategic Decision

Do **not** build a second overlapping project.

Use `codebase-context` as the public flagship substrate. Prove or kill the review-context wedge inside it. If the existing retrieval engine fails the evidence gates, simplify or replace that layer rather than inventing another repository.
