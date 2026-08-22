# Flagship Roadmap

Status: **active**  
Spec: `.planning/SPEC.md`  
Operating rule: advance only when the current gate is explicitly PASS.

## How To Use This Roadmap

This file is an executable state machine, not a wishlist.

At the start of a session:

1. find the first phase whose gate is not `PASS`, `KILL`, or permanently `BLOCKED`
2. fix blockers inside that phase before starting anything later
3. make the smallest change needed to answer the phase question
4. run the listed verification
5. record `PASS`, `FIX`, `KILL`, or `BLOCKED`
6. only then move to the next phase

New ideas go to **Backlog** unless they materially change the current gate.

---

# Current State

## Phase 0 — Review-context v1 functional contract

Status: **IN PROGRESS**

Current implementation PR: `#128 feat(review): add bounded review-context packets`

Question:

> Can the public project reliably compile a bounded, versioned review-context packet from an exact committed git change without an LLM?

### Deliverables

- [x] review-context core packet builder
- [x] executable `codebase-context-review` package binary
- [x] exact base/head commit identity
- [x] exact diff fingerprint
- [x] clean-worktree / checked-out-head invariants
- [x] rename and binary handling
- [x] NUL-safe filename parsing
- [x] bounded identifier extraction
- [x] bounded related-context retrieval
- [x] convention/pattern attachment
- [x] warnings / quality metadata
- [x] unit tests for the packet core
- [x] executable-wrapper smoke test
- [x] public review-context documentation
- [x] autonomous product spec and gated roadmap
- [ ] CI quality gate green
- [ ] CI functional test gate green
- [ ] squash merge to `master`

### Gate G0 — Functional publishability

PASS only if all are true:

- [ ] `pnpm lint` has zero errors
- [ ] `pnpm format:check` passes
- [ ] `pnpm type-check` passes
- [ ] `pnpm build` passes
- [ ] full test suite passes
- [ ] executable wrapper smoke passes
- [ ] PR remains mergeable
- [ ] docs describe actual behavior and limitations
- [ ] no performance/reviewer-quality claim has been added

On PASS:

- squash merge PR #128
- evidence level becomes **E1** for the review-context surface
- move immediately to Phase 1

On FAIL:

- fix only the failing G0 requirement
- do not add features

---

# Phase 1 — Freeze the first honest review-context evaluation

Status: **BLOCKED BY G0**

Question:

> What frozen public task set can distinguish useful review context from plausible-looking retrieval noise?

This phase freezes evidence **before** retrieval tuning.

## Required task set

Minimum target:

- 20 public tasks
- at least 5 public repositories
- at least 3 language ecosystems
- mix of small and non-trivial changes
- real bug-fix / review-relevant changes, not only synthetic retrieval queries
- exact repository + base/head commit identity
- public reproducibility

Prefer tasks where ground truth can identify:

- changed files
- causally relevant non-changed files
- relevant symbols/spans when defensible
- actual bug/finding when the task supports reviewer evaluation

## Freeze artifacts

Before looking at treatment results, commit:

- [ ] task manifest
- [ ] repo/commit identities
- [ ] task inclusion/exclusion rationale
- [ ] ground-truth format
- [ ] scorer
- [ ] retrieval limits
- [ ] setup/index accounting policy
- [ ] failure-row policy
- [ ] baseline definitions
- [ ] report schema

## Required retrieval baselines

At minimum:

1. changed files/path signals only
2. repository-native/basic text navigation
3. current `review-context-v1`

If an additional competitor is cheap and reproducible, add it **before** running treatment results.

## Gate G1 — Eval freeze integrity

PASS only if:

- [ ] all tasks are frozen before treatment inspection
- [ ] task set meets diversity minimums
- [ ] scorer does not depend on treatment output
- [ ] baseline budgets are explicit
- [ ] failures stay in denominator
- [ ] no private/employer data is used
- [ ] another engineer could materialize the set from public information

On PASS:

- tag/fingerprint the frozen manifest
- move to Phase 2

On FAIL:

- repair the evaluation design before running any claim-bearing treatment

---

# Phase 2 — Prove or kill repository-context retrieval value

Status: **BLOCKED BY G1**

Question:

> Does the review-context retrieval lane find materially more relevant context than simple baselines at acceptable precision and cost?

No reviewer LLM is needed yet. First isolate retrieval quality.

## Metrics

Record separately:

- relevant-file recall@k
- relevant-span recall@k where ground truth permits
- precision@k
- characters/tokens returned
- setup/index time
- retrieval wall time
- failures / abstentions
- peak memory where practical

## Comparison discipline

- same task set
- same frozen commits
- same k/budget where comparable
- setup/index costs reported, not hidden
- no best-of-N
- no per-task hand tuning

## Gate G2 — Retrieval value

### PASS

Pass if the evidence shows a useful and reasonably general trade-off versus simple baselines.

A PASS does not require winning every task. It requires a defensible aggregate improvement that is not explained by massively larger context budgets.

Then:

- evidence level becomes **E2**
- publish honest result table + failure analysis
- move to Phase 3

### FIX

One bounded repair cycle is allowed if:

- failure mode is coherent and general
- fix can be justified without task-specific branching
- frozen tasks/ground truth remain untouched

After that repair, rerun the full frozen set once.

### KILL

Kill or substantially simplify this retrieval lane if, after the bounded repair:

- simple baselines match/beat it at lower complexity/cost
- precision is too low
- gains are isolated to development repos/frameworks
- setup/index cost overwhelms value

If killed:

- publish the negative result honestly
- retain the deterministic git/review packet pieces that still have value
- redesign from the simplest winning baseline, not from sunk cost

---

# Phase 3 — Measure actual reviewer impact

Status: **BLOCKED BY G2 PASS**

Question:

> Does the bounded context packet improve real review findings when reasoning is held constant?

## Frozen experimental arms

### Control

Same reviewer model + prompt + budget with raw diff/repository-native tools only.

### Treatment

Same reviewer model + prompt + budget plus `review-context-v1`.

Do not give the treatment hidden extra turns/tokens unless that cost difference is explicitly part of the reported trade-off.

## Reviewer harness requirements

- [ ] model/provider/version recorded
- [ ] prompt recorded
- [ ] tool set recorded
- [ ] token/turn budget recorded
- [ ] timeout recorded
- [ ] repeated runs where nondeterminism matters
- [ ] append-only attempt records
- [ ] invalid output / tool failure is terminal evidence
- [ ] no best-of-N selection

## Metrics

Report separately:

- real finding recall
- precision / false positives
- evidence correctness
- unsupported claims
- token/context usage
- wall time
- tool/setup failure rate

## Gate G3 — Reviewer value

### PASS

Pass only if reviewer quality improves enough to justify the added context cost and the effect is not confined to one repo/language.

Then:

- evidence level becomes **E3**
- publish methodology + failure cases
- move to Phase 4

### FIX

One bounded context-compilation repair cycle is allowed if the failure analysis clearly implicates retrieval/context rather than reviewer reasoning.

Do not tune the reviewer prompt per task to rescue the treatment.

### KILL

Kill the claim that this context strategy helps review if the treatment does not produce a meaningful trade-off after the bounded repair cycle.

Do not respond by adding agent orchestration, more models, or a dashboard.

---

# Phase 4 — External reproduction and usefulness

Status: **BLOCKED BY G3 PASS**

Question:

> Can someone outside the development loop reproduce the value and use the product without bespoke help?

## Deliverables

- [ ] stable npm release containing the review command
- [ ] concise README entrypoint
- [ ] one public end-to-end example
- [ ] reproducible evaluation command
- [ ] machine-readable result artifact
- [ ] install/runtime limitations documented
- [ ] external feedback channel

Seek at least one of:

- external engineer reproduces evaluation
- maintainer/user runs it on another repo
- useful issue/PR from an external user
- independent adoption/integration signal

## Gate G4 — External evidence

PASS when there is credible external reproduction/use rather than only owner/agent self-evaluation.

Then evidence level becomes **E4**.

If external users cannot successfully run or understand it, fix usability before expanding scope.

---

# Phase 5 — Real PR workflow integration

Status: **BLOCKED BY G3 PASS; PREFER G4**

Question:

> Is the proven context capability useful enough to integrate into real pull-request workflows?

Only now consider:

- GitHub Actions integration
- GitHub App
- Azure DevOps adapter
- model-agnostic reviewer consumer
- comment drafting
- review result persistence

## Mandatory safety boundary

The first integration must default to **read-only / draft output**.

No autonomous public review comments until:

- reviewer precision is measured
- false-positive policy exists
- explicit opt-in exists
- dry-run evidence exists

## Gate G5 — Operational usefulness

PASS requires:

- real PR input
- reproducible context packet
- reviewer output trace
- explicit failure state
- no silent posting
- measurable latency/cost

---

# Phase 6 — Optional platform/full-stack expansion

Status: **BLOCKED BY PRODUCT EVIDENCE**

This phase exists for product utility and engineering breadth, not portfolio theater.

Promote only if real usage creates a need for shared state, concurrency, observability, or hosted exploration.

Possible components:

- TypeScript/Node API boundary
- async worker/queue for evaluations
- persistent run metadata
- Next.js benchmark/result explorer
- optional authentication
- observability
- one minimal cloud deployment path

The default local-first CLI/MCP path must remain usable without cloud infrastructure.

## Gate G6 — Platform justification

Do not build this phase unless at least one is true:

- external users need shared runs/results
- evaluations require durable async execution
- a real integration needs a service boundary
- operating evidence manually is now a material bottleneck

A desire to demonstrate AWS/Next.js is not sufficient product justification by itself.

---

# Autonomous Routing Rules

When new information arrives, route it as follows.

## CI or test failure

→ current phase blocker  
→ fix before all other work

## Bug in published contract

→ hotfix current stable surface  
→ add regression test  
→ return to current roadmap gate

## Benchmark result

→ update current evidence gate  
→ choose PASS/FIX/KILL/BLOCKED  
→ do not brainstorm around an unfavorable result

## New paper/tool/competitor

Ask:

1. does it change a frozen baseline or invalidate current methodology?
2. does it expose a clear general failure mode?
3. is it cheap enough to add before treatment observation?

If no → Backlog.

## External user/maintainer interest

→ high-priority opportunity  
→ fix adoption blockers ahead of speculative features

## New project idea

→ default Backlog/reject  
→ it must beat finishing the current gate, not merely sound interesting

---

# Work-In-Progress Limits

At any time:

- maximum 1 active flagship product PR
- maximum 1 active claim-bearing evaluation
- maximum 1 bounded repair cycle per failed evidence gate before a kill/rethink decision

Do not maintain parallel speculative implementations of the same hypothesis.

---

# Merge Rules

For roadmap product work:

1. branch from current `master`
2. one primary scope per PR
3. CI must be green
4. relevant evidence gate must be satisfied
5. squash merge unless history itself is useful evidence
6. update this roadmap when a gate changes state

Never merge because the code "looks right" while the required gate is red.

---

# Backlog — Not Active

These are intentionally **not** roadmap commitments.

- AST-aware diff signal extraction
- richer graph expansion
- hosted dashboard
- autonomous PR commenter
- Azure DevOps review adapter
- GitHub App
- queue/worker infrastructure
- Next.js result explorer
- AWS deployment
- multi-user auth
- paid hosted embeddings
- framework-specific reviewer rules
- standalone replacement for existing reviewer products

Promotion rule:

> A backlog item enters Track A only when evidence or external pull shows it is the smallest next step for the current product bottleneck.

---

# Immediate Next Action

**Do not start Phase 1 yet.**

Finish G0 on PR #128:

1. make `src/review-context.ts` exactly Prettier-compliant
2. get quality checks green
3. get full functional tests green, including the executable wrapper smoke
4. remove any temporary verification-only workflow/artifact before merge
5. squash merge PR #128
6. mark G0 PASS
7. only then freeze the Phase 1 evaluation
