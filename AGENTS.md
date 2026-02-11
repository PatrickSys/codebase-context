# Agent Instructions

## Project Constraints

These are non-negotiable. Every PR, feature, and design decision must respect them.

- **Zero-infra**: Everything runs locally via `npx`. No Docker, no GPU, no cloud services required. API keys (OpenAI, etc.) are opt-in alternatives, never requirements.
- **Language/framework agnostic**: The core must work for any codebase. Angular is the first specialized analyzer, but search, indexing, chunking, memory, and patterns must not assume a specific language or framework.
- **Privacy-first**: Code never leaves the machine unless the user explicitly opts into a cloud embedding provider.
- **Small download footprint**: Dependencies should be reasonable for an `npx` install. Multi-hundred-MB downloads need strong justification.
- **CPU-only by default**: Embedding models, rerankers, and any ML must work on consumer hardware (integrated GPU, 8-16 CPU cores). No CUDA/GPU assumptions.
- **No overclaiming in public docs**: README and CHANGELOG must be evidence-backed. Don't claim capabilities that aren't shipped and tested.
- **internal-docs is private**: Never commit `internal-docs/` pointer changes unless explicitly intended. The submodule is always dirty locally; ignore it.

## Evaluation Integrity (NON-NEGOTIABLE)

These rules prevent metric gaming, overfitting, and false quality claims. Violation of these rules means the feature CANNOT ship.

### Rule 1: Eval Sets are Frozen Before Implementation

- **Define test queries and expected results BEFORE writing any code**
- Commit the eval fixture (e.g., `tests/fixtures/eval-queries.json`) BEFORE starting implementation
- **NEVER adjust expected results to match system output** - If the system returns different results, that's a failure, not a fixture bug
- Exception: If the original expected result was factually wrong (file doesn't exist, query is ambiguous), document the correction with justification

### Rule 2: Eval Sets Must Be General

- **Minimum 20 queries** across diverse patterns (exact names, conceptual, multi-concept, edge cases)
- Test on **multiple codebases** (minimum 2: one you control, one public/real-world)
- Include queries that are HARD and likely to fail - don't cherry-pick easy wins
- Eval set must represent real user queries, not synthetic examples designed to pass

### Rule 3: Public Eval Methodology

- Full eval harness code must be in `tests/` (public repository)
- Eval fixtures must be public (or provide reproducible public examples)
- Document how to run eval: `npm run eval -- /path/to/codebase`
- Results must be reproducible by external users

### Rule 4: No Score Manipulation

- **NEVER add heuristics specifically to game eval metrics** (e.g., "if query contains X, boost Y")
- **NEVER adjust scoring to break ties just to improve top-1 accuracy**
- If you add ranking heuristics, they must be general-purpose and justified by search theory, not by "it makes test #7 pass"
- Document all ranking heuristics with research citations or principled justification

### Rule 5: Report Honestly

- Report **both improvements AND failures** (e.g., "9/20 pass, 11/20 fail")
- If top-3 recall is 80% but top-1 is 45%, say so - don't hide behind a single cherry-picked metric
- Acknowledge when improvements are **workarounds** (filtering, heuristics) vs **fundamental** (better embeddings, ML models)
- Include failure analysis in CHANGELOG: "Known limitations: struggles with multi-concept queries"

### Rule 6: Cross-Check with Real Usage

- Before claiming "X% improvement", test on a real codebase you didn't develop against
- Ask: "Would this improvement generalize to a Python codebase? A Go codebase?"
- If the improvement is framework-specific (e.g., Angular-only), say so explicitly

### Violation Response

If any agent violates these rules:
1. **STOP immediately** - do not proceed with the release
2. **Revert** any fixture adjustments made to game metrics
3. **Re-run eval** with frozen fixtures
4. **Document the violation** in internal-docs for learning
5. **Delay the release** until honest metrics are available

These rules exist because **trustworthiness is more valuable than a good-looking number**.

## Codebase Context

**At start of each task:** Call `get_memory` to load team conventions.

**CRITICAL:** When user says "remember this" or "record this":

- STOP immediately and call `remember` tool FIRST
- DO NOT proceed with other actions until memory is recorded
- This is a blocking requirement, not optional

## Internal Documentation (Submodule)

This repository uses a private git submodule for internal notes.

- **Path**: `internal-docs/`
- **Repo**: `https://github.com/PatrickSys/codebase-context-internal.git`

### Quick Setup

```bash
git clone --recurse-submodules https://github.com/PatrickSys/codebase-context.git
```

### Syncing

```bash
git pull --recurse-submodules
git submodule update --remote --merge
```

### Privacy

The `internal-docs` repository is private. It returns a 404 to unauthenticated users. Access requires a GitHub PAT or SSH keys with repository permissions.
