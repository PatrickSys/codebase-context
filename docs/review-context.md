# Review context

`codebase-context-review` turns a committed git diff into a bounded review-context packet.

It is deliberately **not** an AI reviewer. It does not call an LLM, decide whether code is correct, or post comments. Its job is narrower and testable: compile the changed surface, stable diff signals, related codebase context, and current conventions into one reproducible input for a reviewer or evaluation harness.

## Why this exists

A PR reviewer needs more than the patch, but dumping an entire repository into a model is expensive and hard to reproduce. The review-context path creates a deterministic boundary between:

1. **context compilation** — git + local repository analysis
2. **review reasoning** — any model or human reviewer consuming the packet
3. **evaluation** — measuring whether the context actually helps find the right files/spans/issues

Keeping those layers separate makes failures diagnosable. A bad review can be attributed to missing context, bad reasoning, or both instead of hiding every variable behind one agent loop.

## Usage

Build and run from the repository:

```bash
pnpm build
node dist/review-cli.js --base origin/main --head HEAD
```

After package publication, the package also exposes:

```bash
npx codebase-context-review --base origin/main --head HEAD
```

Use `--json` for the complete machine-readable packet:

```bash
npx codebase-context-review \
  --base origin/main \
  --head HEAD \
  --max-queries 8 \
  --max-results 3 \
  --json > review-context.json
```

The command uses merge-base diff semantics (`base...head`), which matches the normal pull-request question: what changed on this branch since it diverged from the base branch?

## Packet contract

The current schema is `review-context-v1`.

The packet contains:

- exact resolved base/head commit SHAs
- SHA-256 fingerprint of the raw git diff
- changed file status, additions/deletions, rename source, and binary flag
- identifiers extracted deterministically from changed lines
- bounded search queries derived from those diff signals
- bounded related-context results from the existing `search_codebase` engine
- edit-preflight/search-quality metadata when the search engine provides it
- current team-pattern/convention output
- explicit warnings when context could not be produced

Absolute local repository paths are not part of the packet contract.

## Bounds

Defaults:

| Bound | Default |
| --- | ---: |
| Changed-file search queries | 8 |
| Related results per query | 3 |
| Identifier candidates per file | 10 |
| Snippet characters per related result | 1,200 |

These are explicit because an unbounded context compiler is not useful evidence. Increasing them is allowed, but benchmark runs should record the values and compare like-for-like.

## Index behavior

If the repository has no existing codebase-context index, the command indexes it before searching. Pass `--no-index` to fail instead, which is useful in controlled benchmark runs where setup/index cost must be measured separately.

The command is local-first. It invokes git and the existing local index/search pipeline; it does not introduce an LLM or external review API.

## What this proves

Shipping this command proves only that the project can compile a deterministic review-oriented context packet from a real git range.

It **does not** prove that the packet improves review quality, catches more bugs, reduces false positives, or beats another context strategy. Those are benchmark claims and remain blocked until measured.

## Evaluation path

The intended evaluation is an ablation, not a marketing benchmark:

1. freeze a set of public PR/bug-fix tasks before observing lane outputs
2. run the same reviewer/model with **raw diff only**
3. run the same reviewer/model with **raw diff + `review-context-v1` packet**
4. keep model, prompt, turn/token budget, timeout, and scoring fixed
5. score bug/finding recall and precision, evidence quality, false positives, token cost, and wall time separately
6. report setup/index failures as failures, not as competitor losses
7. do not publish a superiority claim from a one-task pilot

The existing ContextBench protocol already follows the same evidence discipline for repository-context retrieval. Review-specific claims should meet at least the same standard rather than creating a weaker parallel benchmark.

## Current limitations

- Only committed git refs are supported in v1; working-tree/staged review is intentionally deferred.
- Query generation is lexical and deterministic. It extracts identifiers from changed lines and falls back to path signals; it is not AST-aware yet.
- The command searches the current repository index. A stale index can therefore produce stale related context; search-quality/preflight output should be preserved by consumers.
- Large diffs are bounded by the CLI git-buffer limit and fail rather than silently truncating the raw fingerprint input.
- Binary files are recorded but do not generate identifier-based queries.
- The packet is context, not a verdict. A consumer should never turn `preflight.ready` into "the change is correct."

## Next gate

Do not add reviewer-agent features until a small frozen public evaluation can answer this first question:

> Does `review-context-v1` improve relevant-file/span coverage at an acceptable precision and context cost compared with the same reviewer using the raw diff/repository tools alone?

If the answer is no, fix or kill this lane before adding more orchestration.
