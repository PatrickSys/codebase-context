# Evaluation Fixtures

This directory contains frozen evaluation sets for testing code search quality.

## Files

- `eval-angular-spotify.json` - 20 semantic queries against [angular-spotify](https://github.com/trungk18/angular-spotify) (public, reproducible)

## Running Evaluations

### Prerequisites

1. Clone the test codebase:
```bash
git clone https://github.com/trungk18/angular-spotify /path/to/angular-spotify
```

2. Build this project:
```bash
npm install
npm run build
```

### Run Evaluation

```bash
node scripts/run-eval.mjs /path/to/angular-spotify --fixture tests/fixtures/eval-angular-spotify.json
```

### Output Format

The eval script outputs:
- **Top-1 Accuracy**: % of queries where the best result matches expected patterns
- **Top-3 Recall**: % of queries where top-3 results include a match
- **Spec Contamination**: % of queries returning test files
- **Per-category breakdown**: Accuracy by query type (exact-name, conceptual, multi-concept, structural)
- **Failure analysis**: Which queries failed and why

## Evaluation Integrity Rules

⚠️ **CRITICAL**: These eval fixtures are FROZEN. Once committed:

1. **DO NOT** adjust expected results to match system output
2. **DO NOT** add queries during development to "improve" scores
3. **DO NOT** remove "hard" queries that the system fails
4. **DO NOT** tune the system on this eval set then report scores

### Proper Usage

✅ **CORRECT**:
- Commit frozen eval BEFORE making changes
- Use eval to measure improvement honestly
- Report failures transparently
- Create NEW eval sets for iteration

❌ **INCORRECT**:
- Adjusting fixture during development ("fixture fixes")
- Cherry-picking queries that work well
- Overfitting to this specific codebase
- Reporting scores without disclosing methodology

## Query Design Principles

### Semantic Queries (NOT keyword matching)

Queries are designed to test **semantic understanding**, not keyword matching:

- ✅ "skip to next song" → should find `player-api.ts` (no "skip" keyword in file)
- ✅ "persist data across browser sessions" → should find `local-storage.service.ts`
- ✅ "add authorization token to API requests" → should find `auth.interceptor.ts`

- ❌ "PlayerApiService" → keyword match (too easy)
- ❌ "player api" → keyword match (too easy)

### Expected Patterns (NOT specific paths)

Expected results use **patterns** that work across codebases:

```json
{
  "expectedPatterns": ["player", "api"],
  "expectedNotPatterns": [".spec.", ".test."]
}
```

This matches:
- `libs/web/shared/data-access/spotify-api/src/lib/player-api.ts` ✅
- `apps/music/src/services/player-api.service.ts` ✅
- `player-api.spec.ts` ❌ (excluded by expectedNotPatterns)

### Query Categories

1. **conceptual** (7 queries): Natural language descriptions requiring semantic understanding
2. **multi-concept** (7 queries): Combining multiple concepts (hardest)
3. **exact-name** (3 queries): Class/service names (baseline)
4. **structural** (3 queries): Framework-specific patterns (NgRx, interceptors)

## Ground Truth Verification

Ground truth established via manual code review:

1. Read the actual code to understand what it does
2. Verify the expected file implements the described functionality
3. Check for similar files that should also match
4. Document reasoning in query notes

Example:
- Query: "skip to next song"
- Expected: `player-api.ts`
- Reasoning: File contains `next()` method that calls `/me/player/next` API endpoint

## Reproducing Results

To reproduce published results:

1. Clone the exact codebase version:
```bash
git clone https://github.com/trungk18/angular-spotify
cd angular-spotify
git checkout <commit-hash-from-published-results>
```

2. Use the frozen eval fixture (committed before measurements)
3. Run eval on both baseline and new version
4. Compare metrics transparently

## Adding New Eval Sets

When creating new eval sets:

1. Design queries BEFORE any implementation
2. Establish ground truth via manual review
3. Test on multiple codebases (not just one)
4. Include "hard" queries expected to fail
5. Commit and tag BEFORE running any measurements
6. Document methodology in query notes

See this README for full guidelines.
