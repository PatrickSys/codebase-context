# Implementation Plan: Circular Dependency Detection

**Goal**: Add "Active Analysis" capability to `codebase-context-mcp` to close the gap with CodePrism.
**Feature**: `detect_circular_dependencies` tool.

## 1. Context & Motivation
- **Source**: Competitive Research (CodePrism) & Reddit Feedback (shifting to "Active Analysis").
- **Why**: Circular dependencies ("toxic couplings") are a clear negative signal. Identifying them fits our "Codebase Sociologist" persona (detecting bad relationships).
- **Current State**: We already build a full `ImportGraph` in memory during indexing. We just don't analyze it for cycles.

## 2. Technical Approach

### Data Source
- Use the existing `ImportGraph` class in `src/analyzer/import-graph.ts` (or similar).
- It already tracks `imports: string[]` for each file.

### Algorithm
- **Choice**: Tarjan's Strongly Connected Components (SCC) algorithm OR simple DFS with recursion stack.
- **Preference**: **DFS with Recursion Stack** is often simpler for just finding *simple* cycles to report to a user.
- **Logic**:
    1.  Build graph from `ImportGraph` (nodes = fileIds, edges = imports).
    2.  Iterate all nodes.
    3.  DFS(node, visited, recursionStack).
    4.  If node in `recursionStack` -> Cycle detected.
    5.  Backtrack.

### Tool Definition (`src/tools/analysis.ts`)
```typescript
{
  name: "detect_circular_dependencies",
  description: "Analyze the import graph to detect circular dependencies between files.",
  inputSchema: {
    type: "object",
    properties: {
      scope: { type: "string", description: "Optional path prefix to limit analysis" }
    }
  }
}
```

### Output Format
```json
{
  "cycles": [
    [
      "src/A.ts",
      "src/B.ts",
      "src/C.ts",
      "src/A.ts"
    ]
  ],
  "count": 1
}
```

## 3. Implementation Tasks
1.  **Modify `ImportGraph`**: Add a `findCycles()` method.
2.  **Register Tool**: Add `detect_circular_dependencies` to the MCP server.
3.  **Test**: Create a fixture with A->B->A import cycle and verify detection.

## 4. Nuances
- **Barrels (`index.ts`)**: These often cause "benign" cycles in some toolings. We might need a filter to ignore them or flag them differently.
- **Type-only imports**: If possible, we should distinguish value imports (runtime cycle) vs type imports (erased). The current tokenizer might not distinguish this perfectly. Start with *all* imports for MVP.
