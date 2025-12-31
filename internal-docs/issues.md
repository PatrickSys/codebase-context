# Issues (Active / Observed)

This document captures **currently observed** issues (or suspected issues) in real runs of the MCP server.

It is intentionally **separate** from `internal-docs/ARCHIVE/ISSUES.md` (historical log + previously proposed fixes).

---

## Issue: `search_codebase` logs LanceDB schema error (`No vector column found`) and silently degrades to keyword-only

### Status

- **Observed**: ✅ Yes (Cursor MCP run on 2025-12-31)
- **Severity**: **High** (semantic search reliability + trust in results)
- **User impact**: Search results may still appear “fine”, but are **not semantic** (quality drops, and users can’t tell).

### Where we saw it

Cursor output channel: **`anysphere.cursor-mcp.MCP user-codebase-context`**

Relevant excerpt (lines 49–136 from the run you provided):

```text
2025-12-31 17:40:12.543 [info] Calling tool 'get_codebase_metadata' with toolCallId: call_ilf0nvOUi3k9MWSDnz2BUXW9
fc_04381488745a531d01695551ee0dc8819792ae9c69f8a4f742
2025-12-31 17:40:12.567 [error] Loading statistics from C:\Users\patrick.colom\Repos\SSP_Portal\.codebase-index.json: 1178 chunks

2025-12-31 17:40:12.568 [error] Loading statistics from C:\Users\patrick.colom\Repos\SSP_Portal\.codebase-index.json: 1178 chunks

2025-12-31 17:40:12.575 [info] Successfully called tool 'get_codebase_metadata'
2025-12-31 17:40:12.815 [info] Handling CallTool action for tool 'search_codebase'
2025-12-31 17:40:12.816 [info] Calling tool 'search_codebase' with toolCallId: call_PolhLSXQhAzzOqTc3szqGyMv
fc_04381488745a531d01695551ee15088197aac7c945c2acb3e6
2025-12-31 17:40:12.881 [error] [search] Loaded pattern intelligence: 0 declining, 8 rising patterns

2025-12-31 17:40:12.881 [error] [search] Loaded pattern intelligence: 0 declining, 8 rising patterns

2025-12-31 17:40:12.881 [error] Loading embedding model: Xenova/bge-small-en-v1.5
(First run will download ~130MB model)

2025-12-31 17:40:12.881 [error] Loading embedding model: Xenova/bge-small-en-v1.5
(First run will download ~130MB model)

2025-12-31 17:40:13.349 [error] Model loaded successfully: Xenova/bge-small-en-v1.5

2025-12-31 17:40:13.349 [error] Model loaded successfully: Xenova/bge-small-en-v1.5

2025-12-31 17:40:13.704 [error] Opened existing LanceDB table
2025-12-31 17:40:13.705 [error] Opened existing LanceDB table
2025-12-31 17:40:13.717 [error] Failed to search: [Error: Failed to execute query stream: Schema Error: No vector column found to create index] {
  code: 'GenericFailure'
}

2025-12-31 17:40:13.718 [error] Failed to search: [Error: Failed to execute query stream: Schema Error: No vector column found to create index] {
  code: 'GenericFailure'
}

2025-12-31 17:40:14.315 [info] Successfully called tool 'search_codebase'
2025-12-31 17:40:14.645 [info] Handling CallTool action for tool 'detect_circular_dependencies'
2025-12-31 17:40:14.645 [info] Calling tool 'detect_circular_dependencies' with toolCallId: call_fbbN7nSJmMWZqLrArmYNgL7x
fc_04381488745a531d01695551ee275c8197a6e3579eba53fa6d
2025-12-31 17:40:14.649 [info] Successfully called tool 'detect_circular_dependencies'
2025-12-31 17:40:18.906 [info] Handling CallTool action for tool 'search_codebase'
2025-12-31 17:40:18.907 [info] Calling tool 'search_codebase' with toolCallId: call_AH5Gk878vT9LY8gs3uYHhxoh
fc_04381488745a531d01695551f48cd0819781ddb18c8066e7d1
2025-12-31 17:40:18.936 [error] [search] Loaded pattern intelligence: 0 declining, 8 rising patterns

2025-12-31 17:40:18.936 [error] [search] Loaded pattern intelligence: 0 declining, 8 rising patterns

2025-12-31 17:40:18.940 [error] Opened existing LanceDB table

2025-12-31 17:40:18.940 [error] Opened existing LanceDB table

2025-12-31 17:40:18.941 [error] LanceDB initialized at: C:\Users\patrick.colom\Repos\SSP_Portal\.codebase-index
2025-12-31 17:40:18.941 [error] LanceDB initialized at: C:\Users\patrick.colom\Repos\SSP_Portal\.codebase-index

2025-12-31 17:40:18.949 [error] Failed to search: [Error: Failed to execute query stream: Schema Error: No vector column found to create index] {
  code: 'GenericFailure'
}

2025-12-31 17:40:18.949 [error] Failed to search: [Error: Failed to execute query stream: Schema Error: No vector column found to create index] {
  code: 'GenericFailure'
}

2025-12-31 17:40:19.397 [info] Successfully called tool 'search_codebase'
2025-12-31 17:40:23.219 [info] Handling CallTool action for tool 'search_codebase'
2025-12-31 17:40:23.219 [info] Calling tool 'search_codebase' with toolCallId: call_oIiAU2CVCIAdIZhwVkyqc9fr
fc_04381488745a531d01695551f8cefc8197859debc0c03bdae7
2025-12-31 17:40:23.252 [error] [search] Loaded pattern intelligence: 0 declining, 8 rising patterns

2025-12-31 17:40:23.252 [error] [search] Loaded pattern intelligence: 0 declining, 8 rising patterns

2025-12-31 17:40:23.256 [error] Opened existing LanceDB table
LanceDB initialized at: C:\Users\patrick.colom\Repos\SSP_Portal\.codebase-index

2025-12-31 17:40:23.256 [error] Opened existing LanceDB table
LanceDB initialized at: C:\Users\patrick.colom\Repos\SSP_Portal\.codebase-index

2025-12-31 17:40:23.262 [error] Failed to search: [Error: Failed to execute query stream: Schema Error: No vector column found to create index] {
  code: 'GenericFailure'
}

2025-12-31 17:40:23.262 [error] Failed to search: [Error: Failed to execute query stream: Schema Error: No vector column found to create index] {
  code: 'GenericFailure'
}
```

### What this means (behavioral summary)

- The server **loads**:
  - the keyword index from `C:\Users\patrick.colom\Repos\SSP_Portal\.codebase-index.json` (`1178 chunks`)
  - the pattern intelligence from `...\.codebase-intelligence.json`
  - the embedding model `Xenova/bge-small-en-v1.5`
  - an **existing** LanceDB table in `...\.codebase-index`
- Then **semantic vector search fails** with:
  - `Schema Error: No vector column found to create index`
- Despite that, Cursor reports:
  - `Successfully called tool 'search_codebase'`

This can happen if the system returns results using **keyword-only search**, even when semantic fails.

In the current repo code, the LanceDB provider catches semantic failures and returns an empty set:

```ts
// src/storage/lancedb.ts
try {
  let query = this.table.vectorSearch(queryVector).limit(limit);
  const results = await query.toArray();
  return results.map(...);
} catch (error) {
  console.error('Failed to search:', error);
  return [];
}
```

And the hybrid search logic will still return keyword matches:

```ts
// src/core/search.ts (high level)
if (useSemanticSearch && embeddingProvider && storageProvider) {
  try { await semanticSearch(...) } catch { /* warn and continue */ }
}
if (useKeywordSearch && fuseIndex) {
  try { await keywordSearch(...) } catch { /* warn and continue */ }
}
```

So from the user’s perspective: “search works”, but it’s **not actually semantic**.

### Expected behavior

One of:

- **Auto-heal**: detect stale LanceDB schema and rebuild (drop + re-index) **before** attempting vector search
- **Explicitly report degraded mode**: tool response should include a flag like `semanticAvailable: false` and/or an `error`/`warning` field
- **Fail fast** (less ideal UX): return tool error if semantic search is requested but cannot be executed

### Why the LanceDB schema error likely happens

This error is consistent with one of:

- The table `code_chunks` was created by an older version that did not store embeddings into a `vector` column.
- A partial/failed indexing run created a table without vectors.
- A schema migration happened, but the on-disk index folder was not rebuilt.
- Multiple versions of the server were run against the same `...\.codebase-index` directory (e.g., switching between local build and `npx codebase-context`).

### Important nuance: the repo code already contains a “stale schema” guard

In `codebase-context-mcp` **source** (`src/storage/lancedb.ts`), `initialize()` attempts to check for a `vector` column and drop the table if it’s missing.

Given your logs show:

- “Opened existing LanceDB table”
- then immediately “No vector column found…”

that suggests at least one of:

- Cursor is running a **different build/version** than the current source tree (published package vs local code).
- The schema check did not execute (e.g., exception path, different provider implementation, or table schema API differences).
- The table has a column name mismatch (not literally `vector`) in that on-disk index.

### How to reproduce (likely)

1. Start server once to generate `...\.codebase-index` / `...\.codebase-index.json`.
2. Mutate or replace `...\.codebase-index` with an older/stale format (or downgrade/upgrade server versions).
3. Call `search_codebase` from Cursor.
4. Observe “Successfully called tool” but stderr shows:
   - `Schema Error: No vector column found to create index`

### Workarounds (today)

- **Hard reset the semantic index** (will force rebuild):
  - Delete `C:\Users\patrick.colom\Repos\SSP_Portal\.codebase-index`
  - Optionally also delete `C:\Users\patrick.colom\Repos\SSP_Portal\.codebase-index.json` if it is inconsistent
  - Restart the MCP server and let it re-index

### Recommended fix (product behavior)

- **Expose degraded-mode status to the caller**:
  - Include a field in `search_codebase` output indicating which subsystem was used:
    - `semanticUsed: boolean`
    - `keywordUsed: boolean`
    - `semanticError?: string`
- **Schema validation must be definitive**:
  - If the LanceDB table exists but lacks embeddings, drop and rebuild before queries.
  - Consider writing an explicit on-disk “index schema version” marker (e.g., in `.codebase-index/VERSION`).

### Related observations from the same log excerpt (not the core issue, but relevant)

- **All messages are labeled `[error]`** even when informational (model loaded, opened table, etc.).
  - This is due to stderr-only logging behavior in Cursor’s MCP output (common for stdio MCP servers).
- **Many lines appear duplicated**.
  - Could be multiple providers initializing per call, or client-side stderr duplication/multiplexing.

---

## (Minor) Cursor does not list MCP resources even though resources can be read

### Symptom

- `ListResources` appears empty in Cursor tooling (“No MCP resources found”)
- But reading `codebase://context` works and returns content

### Impact

Low. Tools function correctly; resource discovery in the UI is just misleading.

---

## Technical Debt & Known Limitations

### 1. Large Repo Performance (Git Streaming)
- **Issue**: `get_file_health` relies on streaming `git log`. On ultra-large repos (50k+ commits), this can cause timeouts.
- **Status**: Accepted limitation for v1.2.
- **Future Mitigation**: Implement caching or pre-computed history stats (v1.3+).

### 2. Blocking "Compliance" UX
- **Issue**: The proposed `verify_compliance` tool (v1.3) risks blocking the user workflow if implemented as a strict "PASS/FAIL" gate.
- **Status**: Design concern.
- **Mitigation**: Plan to implement as "Advisory/Preview" mode first.

