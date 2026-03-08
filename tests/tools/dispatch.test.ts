import { describe, it, expect } from 'vitest';
import { TOOLS, dispatchTool } from '../../src/tools/index.js';
import type { ToolContext } from '../../src/tools/types.js';

describe('Tool Dispatch', () => {
  it('exports all 10 tools', () => {
    expect(TOOLS.length).toBe(10);
    expect(TOOLS.map((t) => t.name)).toEqual([
      'search_codebase',
      'get_codebase_metadata',
      'get_indexing_status',
      'refresh_index',
      'get_style_guide',
      'get_team_patterns',
      'get_symbol_references',
      'detect_circular_dependencies',
      'remember',
      'get_memory'
    ]);
  });

  it('has unique tool names', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all tools have descriptions', () => {
    TOOLS.forEach((tool) => {
      expect(tool.description).toBeTruthy();
      expect(typeof tool.description).toBe('string');
    });
  });

  it('all tools have inputSchema', () => {
    TOOLS.forEach((tool) => {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    });
  });

  it('all tools expose project and project_directory for multi-root routing', () => {
    TOOLS.forEach((tool) => {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toMatchObject({
        project: expect.objectContaining({
          type: 'string'
        }),
        project_directory: expect.objectContaining({
          type: 'string'
        })
      });
    });
  });

  it('dispatchTool returns error for unknown tool', async () => {
    const mockCtx: ToolContext = {
      indexState: { status: 'idle' },
      paths: {
        baseDir: '/tmp',
        memory: '/tmp/memory.jsonl',
        intelligence: '/tmp/intelligence.json',
        keywordIndex: '/tmp/index.json',
        vectorDb: '/tmp/vector-db'
      },
      rootPath: '/tmp',
      performIndexing: () => undefined
    };

    const result = await dispatchTool('unknown_tool', {}, mockCtx);

    expect(result.isError).toBe(true);
    expect(result.content).toBeDefined();
    expect(result.content![0].text).toContain('Unknown tool');
  });

  it('dispatchTool routes to correct handlers', async () => {
    const mockCtx: ToolContext = {
      indexState: { status: 'idle' },
      paths: {
        baseDir: '/tmp',
        memory: '/tmp/memory.jsonl',
        intelligence: '/tmp/intelligence.json',
        keywordIndex: '/tmp/index.json',
        vectorDb: '/tmp/vector-db'
      },
      rootPath: '/tmp',
      performIndexing: () => undefined
    };

    // Test get_indexing_status (simplest handler without file I/O)
    const result = await dispatchTool('get_indexing_status', {}, mockCtx);
    expect(result.content).toBeDefined();
    expect(result.content![0].type).toBe('text');
    const text = result.content![0].text;
    expect(text).toContain('idle');
  });
});
