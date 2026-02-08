// Centralized constants for on-disk MCP artifacts.
// Keep this module dependency-free to avoid import cycles.

export const CODEBASE_CONTEXT_DIRNAME = '.codebase-context' as const;

export const MEMORY_FILENAME = 'memory.json' as const;
export const INTELLIGENCE_FILENAME = 'intelligence.json' as const;
export const KEYWORD_INDEX_FILENAME = 'index.json' as const;
export const VECTOR_DB_DIRNAME = 'index' as const;
export const MANIFEST_FILENAME = 'manifest.json' as const;
