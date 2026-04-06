BEWARE: AI-GENERATED MARKDOWN FILE, DO NOT BLINDLY TRUST IT

# Roadmap

## Active Milestone

- [-] **v2.0.0 Map-First Discovery Relaunch** - Phases 5-9 (in progress)

## Active Phases

- [x] **Phase 5: Freeze Discovery Benchmark** - lock the discovery-only benchmark and fairness rules before product-shaping changes land
- [x] **Phase 6: Bootstrap First-Run Adoption** - ship the interactive bootstrap wizard for the first-wave clients
- [ ] **Phase 7: Promote the Map Surface** - make repo intelligence the primary first-call surface in CLI and MCP
- [ ] **Phase 8: Tighten the Search Contract** - formalize compact-vs-full search and nuanced edit-readiness
- [ ] **Phase 9: Publish Proof and Sync the Public Surface** - finish v2 with honest proof, locked messaging, and aligned public artifacts

## Phase Details

### Phase 5: Freeze Discovery Benchmark

**Goal**: lock the discovery-only benchmark and fairness rules before product-shaping changes so v2 claims cannot be gamed.
**Status**: [x]
**Requirements**: `EVAL-01`
**Success Criteria**:
1. Frozen benchmark fixtures are locked for `angular-spotify` and at least one non-Angular public repo before discovery-contract implementation work begins.
2. Reported metrics stay discovery-only: exploration usefulness, payload cost, first relevant hit, and best-example usefulness.
3. Baseline plus named competitor setups are documented with explicit limitations and no fairness shortcuts.
4. The benchmark names `raw Claude Code`, `GrepAI`, `jCodeMunch`, and `codebase-memory-mcp`, with `codebase-memory-mcp` framed as the heavier structural comparator rather than the primary public baseline.
5. The benchmark has a real ship gate: v2 must beat raw Claude Code on exploration payload cost and at least one usefulness metric across the fixed public tasks, stay competitive with the named MCP comparators, and report any lost slices before broader relaunch claims are made.

### Phase 6: Bootstrap First-Run Adoption

**Goal**: make first-run setup and instruction seeding simple for a new public user without turning bootstrap into a separate product.
**Status**: [x]
**Depends on**: Phase 5
**Requirements**: `BOOT-01`
**Plans**: 1 plan

Plans:
- [x] 06-01-PLAN.md — Add @inquirer/prompts, implement init wizard in src/cli-init.ts, wire subcommand, add unit tests

**Success Criteria**:
1. `codebase-context init` supports `Claude Code`, `Cursor`, `Codex`, and `OpenCode` only for the first wave.
2. The wizard is interactive, preview-first, generates MCP config plus a standard instruction block, and asks before patching an existing instructions file.
3. Safe recommendations, write paths, and client-specific generated output are covered by tests.
4. Bootstrap stays bounded; if scope slips, client breadth is trimmed before new abstraction or setup-product work is added.

### Phase 7: Promote the Map Surface

**Goal**: expose existing repo intelligence as the primary first-call product surface before free-form search.
**Status**: [ ]
**Depends on**: Phase 6
**Requirements**: `MAP-01`, `MSG-01`
**Success Criteria**:
1. CLI users get a new `map` command and MCP users get the tightened `codebase://context` resource as the compact map contract.
2. This phase does not add a new MCP map tool.
3. The map summarizes architecture, active patterns, best examples, and suggested next calls.
4. Docs and onboarding flows present the map-first workflow as the default first-use path, with search framed as the next step.

### Phase 8: Tighten the Search Contract

**Goal**: make `search_codebase` smaller, clearer, and more self-sufficient before edits.
**Status**: [ ]
**Depends on**: Phase 7
**Requirements**: `DISC-01`, `SAFE-01`
**Success Criteria**:
1. `search_codebase` defaults to `compact`, supports explicit `full`, and exposes response-budget metadata in both modes.
2. Compact mode is explicitly bounded to at most 6 ranked pointers, 1 concise pattern summary, 1 best example, and up to 2 next hops without repeating heavy memory by default.
3. Low-confidence retrieval blocks edit intents, `aging` warns, and `stale` abstains with retry or reindex guidance.

### Phase 9: Publish Proof and Sync the Public Surface

**Goal**: publish the proof artifact and make the v2 story coherent across docs, registry surfaces, and package metadata.
**Status**: [ ]
**Depends on**: Phase 8
**Requirements**: `PROOF-01`
**Success Criteria**:
1. The discovery benchmark is run and checked in as a reproducible artifact with explicit limitations.
2. README hero, subheadline, and exact first-screen bullets, plus docs, support matrix, registry metadata, and CHANGELOG, reflect shipped v2 behavior only.
3. The benchmark doc, comparison table, registry sync checklist, and short demo script are shipped as explicit relaunch artifacts.
4. Any unsupported comparator setup or broader benchmark ambition is documented explicitly rather than implied as shipped.

## Archived Milestones

- [x] [v1.9.0 - HTTP Transport + Multi-repo Configuration](.\milestones\v1.9.0-ROADMAP.md) - 4 phases, 4 plans, shipped 2026-03-28

## Current Status

Active milestone is `v2.0.0 Map-First Discovery Relaunch`. Phase 5 and Phase 6 are complete. Next step is `/gsdd-verify 6` then `/gsdd-progress` to route into Phase 7.
