# Evaluation Fixtures

This directory contains frozen evaluation sets for testing retrieval and discovery quality.

## Files

- `eval-angular-spotify.json` - 20 semantic retrieval queries against [angular-spotify](https://github.com/trungk18/angular-spotify)
- `eval-controlled.json` - 20 frozen retrieval queries for the in-repo controlled fixture codebase
- `discovery-angular-spotify.json` - 12 discovery tasks for `angular-spotify`
- `discovery-excalidraw.json` - 12 discovery tasks for `Excalidraw`
- `discovery-benchmark-protocol.json` - frozen scope, comparator set, fairness rules, and ship gate for the discovery benchmark

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

### Run Retrieval Evaluation

```bash
node scripts/run-eval.mjs /path/to/angular-spotify --mode retrieval --fixture-a tests/fixtures/eval-angular-spotify.json

# Controlled fixture example (no network)
node scripts/run-eval.mjs tests/fixtures/codebases/eval-controlled --mode retrieval --fixture-a tests/fixtures/eval-controlled.json
```

### Run Discovery Evaluation

```bash
node scripts/run-eval.mjs /path/to/angular-spotify /path/to/excalidraw --mode discovery
```

Optional comparator evidence file:

```bash
node scripts/run-eval.mjs /path/to/angular-spotify /path/to/excalidraw --mode discovery --competitor-results /path/to/discovery-comparator-results.json
```

### Output Format

The retrieval harness outputs:

- **Top-1 Accuracy**: % of queries where the best result matches expected patterns
- **Top-3 Recall**: % of queries where top-3 results include a match
- **Spec Contamination**: % of queries returning test files
- **Per-category breakdown**: Accuracy by query type (exact-name, conceptual, multi-concept, structural)
- **Failure analysis**: Which queries failed and why

The discovery harness outputs:

- **Average usefulness**: expected-signal match rate with forbidden-signal penalties
- **Average payload**: UTF-8 bytes returned by the current shipped surface
- **Average estimated tokens**: fixed bytes-to-token heuristic for fair comparison
- **Average first relevant hit**: position of the first relevant file for search tasks
- **Best-example usefulness**: whether find tasks surfaced the expected exemplar

## Evaluation Integrity Rules

⚠️ **CRITICAL**: These fixtures are FROZEN. Once committed:

1. **DO NOT** adjust expected results to match system output
2. **DO NOT** add queries during development to "improve" scores
3. **DO NOT** remove "hard" queries that the system fails
4. **DO NOT** tune the system on this eval set then report scores

For discovery specifically:

5. **DO NOT** benchmark an unreleased `map` command or a new MCP map tool
6. **DO NOT** claim implementation quality from this benchmark
7. **DO** keep comparator setup limitations explicit when a lane requires manual log capture

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

1. Clone the exact codebase versions:

```bash
git clone https://github.com/trungk18/angular-spotify /path/to/angular-spotify
git -C /path/to/angular-spotify checkout ff9efa765c53cfde78c9a172c62d515ae8ef9fe0

git clone https://github.com/excalidraw/excalidraw /path/to/excalidraw
git -C /path/to/excalidraw checkout e18c1dd213000dde0ae94ef7eb00aab537b39708
```

2. Use the frozen eval fixture (committed before measurements)
3. Run eval on both pinned repos
4. Compare metrics transparently

## Discovery Benchmark Scope

Phase 5 freezes discovery around three jobs only:

1. **Map** - repo orientation and subsystem awareness
2. **Find** - dominant local pattern and best-example discovery
3. **Search** - targeted file and symbol discovery with low noise

Allowed current-surface lane:

- `search_codebase`
- `get_codebase_metadata`
- `get_team_patterns`
- `codebase://context`

Explicitly out of bounds:

- unreleased `map` CLI behavior
- a new MCP `get_codebase_map` tool
- implementation-quality or code-generation claims

## Comparator Notes

- `raw Claude Code` is the primary baseline and uses a manual log-capture lane
- `GrepAI`, `jCodeMunch`, and `codebase-memory-mcp` are the named MCP comparators
- `codebase-memory-mcp` is the heavier structural comparator, not the primary public baseline
- If a comparator cannot be run fairly via direct tool calls, document the public setup and use the manual lane rather than inventing a fake automation path

## Comparator Setup Commands

These commands document the public setup path for the named comparator set. They do not convert the benchmark into a built-in automation path; the named comparators still run through the documented manual log-capture lane.

### raw Claude Code

Public install path:

```bash
npm install -g @anthropic-ai/claude-code
cd /path/to/angular-spotify
claude
```

Use the same Claude Code version, model, and base instructions across all baseline captures.

### GrepAI

Public install path from the project README:

```bash
curl -sSL https://raw.githubusercontent.com/yoanbernabeu/grepai/main/install.sh | sh
ollama pull nomic-embed-text
cd /path/to/angular-spotify
grepai init
grepai watch
```

Windows PowerShell install path:

```powershell
irm https://raw.githubusercontent.com/yoanbernabeu/grepai/main/install.ps1 | iex
```

### jCodeMunch

Public install path from PyPI:

```bash
pip install jcodemunch-mcp
claude mcp add jcodemunch uvx jcodemunch-mcp
cd /path/to/angular-spotify
claude
```

Use the same MCP-enabled Claude Code session style for the benchmark capture and let jCodeMunch index the project through its documented first-run flow.

### codebase-memory-mcp

Public install path from the project README:

```bash
curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash
cd /path/to/angular-spotify
```

Windows PowerShell install path:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.ps1 | iex"
```

After installation, restart the coding agent and use the documented prompt to index the project before running the manual benchmark capture.

## Adding New Eval Sets

When creating new eval sets:

1. Design queries BEFORE any implementation
2. Establish ground truth via manual review
3. Test on multiple codebases (not just one)
4. Include "hard" queries expected to fail
5. Commit and tag BEFORE running any measurements
6. Document methodology in query notes

See this README for full guidelines.
