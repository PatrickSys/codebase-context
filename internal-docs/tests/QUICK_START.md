# Testing Infrastructure - Quick Start

## For Your Next Test Session

1. **Copy the template**:
   ```bash
   cp -r tests/TEMPLATE tests/SSP_Portal_MMDD
   ```

2. **Fill in TEST_SESSION.md**:
   - Update date, model name
   - Run the test 3 times
   - Fill in the summary table with scores

3. **Score the component** (after each run):
   ```bash
   node tests/scripts/score-component.js <path-to-component>
   ```

4. **Verify build**:
   ```bash
   cd SSP_Portal
   pnpm nx build admin
   ```

5. **Update summary**:
   - Add row to `TEST_RESULTS_SUMMARY.md`

## Standard Models

- GPT 5.2 High (Codex CLI or Cursor)
- Gemini 3 Pro (Gemini CLI)
- Claude Haiku 4.5 (Cursor)

## Pattern Scorecard (7 points)

1. inject() DI
2. Signals (signal/computed/effect)
3. Standalone component
4. Jest tests
5. @codeblue/prime wrappers
6. OnPush change detection
7. Design tokens (var(--))

Score: X/7

## What's Automated

- ✅ Pattern detection (score-component.js)
- ✅ Template structure (TEMPLATE/)
- ❌ Running tests (manual)
- ❌ Analyzing results (manual)

Keep it simple. Just use the templates and scoring script.
