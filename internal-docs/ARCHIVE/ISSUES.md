# Known Issues & Technical Debt

This document tracks current issues, their root causes, and proposed solutions.

---

## Issue 1: Log Messages Labeled as `[error]` in IDE

### Symptom
All server logs appear with `[error]` severity in the IDE output panel, even informational messages like:
```
[error] Registered analyzer: angular (priority: 100)
[error] Server ready
[error] Model loaded successfully
```

### Root Cause
The server uses `console.error()` for all logging. This is *partially* correct since stdio MCP servers must reserve `stdout` for JSON-RPC protocol messages. However, the **proper MCP approach** is to use structured logging via `server.sendLoggingMessage()`.

Other MCP servers that display `[INFO]` labels use the MCP SDK's structured logging:
```typescript
// Declare logging capability
const server = new Server({...}, { capabilities: { logging: {} } });

// Use structured logging with severity levels
server.sendLoggingMessage({ level: "info", data: "Server ready" });
```

### Current Code
```typescript
// src/index.ts, src/storage/lancedb.ts, src/embeddings/transformers.ts
console.error("Server ready");  // Always shows as [error]
```

### Proposed Fix
1. Add `logging: {}` to server capabilities
2. Replace all `console.error()` calls with `server.sendLoggingMessage()` using appropriate severity levels:
   - `info`: Normal startup messages, progress updates
   - `warning`: Deprecated features, fallback behavior
   - `error`: Actual errors, failures

### Affected Files
- `src/index.ts` (~30 occurrences)
- `src/storage/lancedb.ts` (~10 occurrences)
- `src/embeddings/transformers.ts` (~6 occurrences)
- `src/core/indexer.ts` (~10 occurrences)
- `src/core/analyzer-registry.ts` (~3 occurrences)

---

## Issue 2: Duplicate Log Lines

### Symptom
Every log message appears twice in the output:
```
Loading embedding model: Xenova/bge-small-en-v1.5
Loading embedding model: Xenova/bge-small-en-v1.5
Model loaded successfully: Xenova/bge-small-en-v1.5
Model loaded successfully: Xenova/bge-small-en-v1.5
```

### Root Cause
The embedding model (`TransformersEmbeddingProvider`) is **not a singleton**. Each `search_codebase` tool call creates a new `CodebaseSearcher`, which initializes a fresh embedding model instance.

The existing `shouldLog` throttling logic (lines 397-404 in `index.ts`) only applies to indexing progress, not to embedding model initialization.

### Why This Happens
1. User calls `search_codebase` → Creates `CodebaseSearcher`
2. `CodebaseSearcher` initializes `TransformersEmbeddingProvider`
3. Provider logs "Loading embedding model..."
4. If multiple searches happen in quick succession, multiple providers log simultaneously
5. Additionally, there may be stream multiplexing in the MCP client that duplicates stderr output

### Proposed Fix
1. **Make embedding provider a singleton** at module level:
   ```typescript
   // src/embeddings/transformers.ts
   let cachedProvider: TransformersEmbeddingProvider | null = null;
   
   export function getEmbeddingProvider(): TransformersEmbeddingProvider {
     if (!cachedProvider) {
       cachedProvider = new TransformersEmbeddingProvider();
     }
     return cachedProvider;
   }
   ```

2. **Or initialize once at server startup** and inject into tools

### Affected Files
- `src/embeddings/transformers.ts`
- `src/core/search.ts`

---

## Issue 3: LanceDB Schema Error (`No vector column found`)

### Symptom
```
Failed to search: [Error: Failed to execute query stream: Schema Error: No vector column found to create index] {
  code: 'GenericFailure'
}
```

Search functionality completely fails, though other tools work normally.

### Root Cause
The LanceDB table at `.codebase-index` exists but has a **stale schema** that doesn't include the `vector` column required for semantic search.

This happens when:
1. Index was created by an older version before embeddings were added
2. Index was created with `skipEmbedding=true`
3. Indexing was interrupted mid-way (wrote metadata but no embeddings)
4. Schema changed across versions without migration

### Why This Is Critical
This breaks the "easy to set up" promise. Users shouldn't need to manually delete index folders when upgrading.

### Current Behavior
- LanceDB opens the existing table (line 42: `this.db.openTable('code_chunks')`)
- No schema validation is performed
- `vectorSearch()` fails because `vector` column doesn't exist

### Proposed Fix Options

| Approach | Effort | Robustness | Recommendation |
|----------|--------|------------|----------------|
| **1. Schema version check** | Low | Good | ✅ Recommended |
| **2. Graceful fallback** | Medium | Best | Consider for Phase 2 |
| **3. Full migration** | High | Overkill | Not needed |

#### Option 1: Schema Version Check (Recommended)
```typescript
// In LanceDBStorageProvider.initialize():
async initialize(storagePath: string): Promise<void> {
  // ... existing code ...
  
  if (tableNames.includes('code_chunks')) {
    this.table = await this.db.openTable('code_chunks');
    
    // Validate schema has vector column
    const schema = await this.table.schema();
    const hasVectorColumn = schema.fields.some(f => f.name === 'vector');
    
    if (!hasVectorColumn) {
      console.error('Detected old index format without embeddings. Rebuilding...');
      await this.db.dropTable('code_chunks');
      this.table = null;
      // Server will trigger re-index on next startup
    } else {
      console.error('Opened existing LanceDB table');
    }
  }
}
```

#### Option 2: Graceful Fallback (Phase 2)
If vector search fails, fall back to keyword-only search. User still gets results, just less relevant.

### Immediate Workaround
Users must manually delete the stale index:
```bash
rm -rf <project-root>/.codebase-index
```
Then restart the MCP server to trigger a fresh index with embeddings.

### Affected Files
- `src/storage/lancedb.ts`

---

## Priority Matrix

| Issue | Severity | Status | Implementation |
|-------|----------|--------|----------------|
| #3 LanceDB Schema | **High** | ✅ Fixed | Schema validation + auto-rebuild |
| #2 Duplicate Logs | Medium | ✅ Fixed | Singleton caching in embeddings/index.ts |
| #1 Log Levels | Low | ✅ Fixed | Added `logging` capability |

---

## Notes

- These issues were discovered during server startup analysis on 2025-12-07
- All fixes implemented and build verified on 2025-12-07
- Startup logs appearing as `[error]` in IDE is expected stdio MCP behavior
