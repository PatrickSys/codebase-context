# Evaluation Methodology

**Purpose:** Ensure search quality claims are honest, reproducible, and generalizable.

**Last Updated:** 2026-02-09

---

## Principles

1. **Eval sets are frozen before implementation** - No adjusting expected results to match system output
2. **Test on multiple codebases** - Don't overfit to a single repo
3. **Public and reproducible** - Anyone can validate our claims
4. **Report failures honestly** - Document what doesn't work, not just what does
5. **Distinguish workarounds from improvements** - Be clear about heuristics vs ML improvements

---

## Current Eval Framework

### Location
- **Harness:** `tests/eval-harness.test.ts`
- **Fixtures:** `tests/fixtures/eval-queries.json`
- **Runner:** `scripts/run-eval.mjs`

### Running Evaluation

```bash
# Build first
npm run build

# Run on a codebase
node scripts/run-eval.mjs /path/to/codebase

# Options:
# --skip-reindex    Use existing index (faster, for iteration)
# --no-rerank       Disable cross-encoder reranker
# --no-redact       Show full file paths (for internal use)
```

### Metrics

- **Top-1 Accuracy:** Is the correct file #1 in results? (strictest metric)
- **Top-3 Recall:** Is the correct file in top-3? (measures retrieval quality)
- **Spec Contamination:** Are test files incorrectly returned for non-test queries?

---

## Current Limitations (v1.6.0)

**WARNING: The v1.6.0 eval set has integrity issues and should NOT be used as evidence of quality.**

### Problems with Current Eval Set

1. **Fixture was created/adjusted during development** (violates Rule 1)
   - Expected results include patterns added after seeing system output
   - Example: Query #9 originally expected `router.service`, expanded to accept `save-login-redirect` and `auth-guard`
   - Example: Query #11 uses partial match `translat` instead of exact `translation`

2. **Too small** (11 queries, single codebase)
   - Easy to overfit
   - Not generalizable

3. **Loose matching** (pattern-based, not exact files)
   - Query can pass if ANY file contains pattern (e.g., "theme")
   - Not strict enough to validate ranking quality

4. **Private test codebase** (SSP_Portal)
   - Results not reproducible by external users
   - Can't verify claims independently

### Impact on v1.6.0 Claims

The "45% → 82%" claim is **NOT TRUSTWORTHY** because:
- Eval set was adjusted during development
- Most improvements are heuristics/workarounds (test filtering, template demotion)
- Cross-encoder reranker was disabled for the 82% result (`--no-rerank`)
- Only tested on one private codebase

**What IS real:**
- ✅ Spec contamination eliminated (0%) - test filtering works
- ✅ Top-3 recall improved (73% → 91%) - retrieval is working better
- ❌ Top-1 accuracy (45% → 82%) - suspect due to fixture adjustments

---

## Recommended Eval Framework (Future)

### Phase 1: Create Frozen Eval Set (BEFORE any implementation)

1. **Select 3 codebases:**
   - 1 internal (that you understand deeply)
   - 1 public popular project (e.g., VS Code, Angular, Next.js)
   - 1 different language/framework (e.g., Python FastAPI, Go project)

2. **Define 20+ queries per codebase:**
   - 5 exact name lookups (e.g., "AuthService")
   - 5 conceptual (e.g., "authentication login")
   - 5 multi-concept (e.g., "user permissions access control")
   - 5 edge cases (ambiguous, multi-file, structural)

3. **Establish ground truth manually:**
   - Use `ripgrep` / `grep` to find correct files
   - List EXACT file paths (not patterns)
   - Document why each file is correct

4. **Commit eval set BEFORE implementation:**
   ```bash
   git add tests/fixtures/eval-{project-name}.json
   git commit -m "feat: add frozen eval set for {feature-name}"
   git tag eval-freeze-{feature-name}
   ```

### Phase 2: Implement & Measure

1. **Run eval BEFORE changes (baseline):**
   ```bash
   node scripts/run-eval.mjs /path/to/codebase1 > baseline-codebase1.txt
   node scripts/run-eval.mjs /path/to/codebase2 > baseline-codebase2.txt
   node scripts/run-eval.mjs /path/to/codebase3 > baseline-codebase3.txt
   ```

2. **Implement feature**

3. **Run eval AFTER changes:**
   ```bash
   node scripts/run-eval.mjs /path/to/codebase1 > improved-codebase1.txt
   node scripts/run-eval.mjs /path/to/codebase2 > improved-codebase2.txt
   node scripts/run-eval.mjs /path/to/codebase3 > improved-codebase3.txt
   ```

4. **Calculate aggregate metrics:**
   - Average top-1 accuracy across all 3 codebases
   - Report min/max (shows variance)
   - Document per-codebase results

### Phase 3: Report Honestly

**CHANGELOG template:**

```markdown
### Search Quality Improvements

**Tested on 3 codebases:** {codebase1}, {codebase2}, {codebase3}
**Eval set size:** {N} queries per codebase (frozen before implementation)

**Aggregate results:**
- Top-1 accuracy: {baseline%} → {improved%} (±{variance}%)
- Top-3 recall: {baseline%} → {improved%} (±{variance}%)
- Spec contamination: {baseline%} → {improved%}

**What improved:**
- {specific improvement 1} (e.g., "eliminated spec contamination via hard filtering")
- {specific improvement 2}

**Known limitations:**
- {failure mode 1} (e.g., "struggles with multi-concept queries")
- {failure mode 2}

**Reproducibility:**
Run `node scripts/run-eval.mjs /path/to/your/codebase` to validate on your own codebase.
```

---

## What To Do With v1.6.0

**Options:**

### Option A: Roll Back (Recommended)
- Unstage v1.6.0 changes
- Create proper frozen eval set following Phase 1 guidelines
- Re-implement with honest eval methodology
- Ship when metrics are trustworthy

### Option B: Ship With Honest Downgrade
- Change version to v1.5.2 (patch, not minor)
- CHANGELOG: "Experimental search improvements (test filtering, RRF fusion)"
- README: NO "82% accuracy" claims
- Acknowledge these are heuristics, not proven improvements
- Add warning: "Search quality claims require validation"

### Option C: Partial Ship
- Ship ONLY the provably good parts:
  - Test file filtering (eliminates spec contamination)
  - RRF fusion (research-backed)
  - Cross-encoder reranker (ML model)
- Remove questionable parts:
  - Intent classification heuristics
  - Template/style demotion
  - Score unclamping
- Version as v1.5.2 "Search filtering improvements"

---

## Commitment Going Forward

**All future search quality claims will:**
1. Use frozen eval sets (committed before implementation)
2. Test on multiple codebases (minimum 2)
3. Report aggregate metrics with variance
4. Document failures and limitations
5. Be reproducible by external users

**This document is a binding commitment.** Any violation means the feature cannot ship until methodology is fixed.

---

## Questions & Answers

**Q: What if I find a bug in the eval fixture?**
A: Document it with evidence (e.g., "file doesn't exist in codebase"), fix it, and re-run both baseline AND improved eval. Commit the fix separately with justification.

**Q: What if my improvement only works on certain codebases?**
A: Say so! "Improvement applies to Angular codebases with DI patterns. Python codebases: not tested."

**Q: What if top-1 accuracy is still bad but top-3 recall is good?**
A: Report both! "Retrieval improved (top-3 recall 90%), ranking still needs work (top-1 accuracy 50%)."

**Q: Can I use heuristics (test filtering, file type demotion)?**
A: Yes, but:
1. Document them as workarounds, not ML improvements
2. They must be general-purpose (not "if query == X, boost Y")
3. Test that they don't break other codebases

---

**Last updated:** 2026-02-09
**Status:** v1.6.0 eval integrity issues identified, new methodology defined
