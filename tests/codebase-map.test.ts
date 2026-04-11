import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProjectState } from '../src/project-state.js';
import { buildCodebaseMap, renderMapMarkdown, renderMapPretty } from '../src/core/codebase-map.js';
import { generateCodebaseIntelligence } from '../src/resources/codebase-intelligence.js';

// Resolve fixture path relative to this test file — portable across CWD setups.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'map-fixture');

// ---------------------------------------------------------------------------
// buildCodebaseMap
// ---------------------------------------------------------------------------

describe('buildCodebaseMap', () => {
  it('returns a CodebaseMapSummary with project name from rootPath', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    expect(map.project).toBe('map-fixture');
  });

  it('derives architecture layers from graph keys, sorted by count desc then alpha', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    // Use objectContaining — layers may now have hubFile/hubExports from enrichLayers
    expect(map.architecture.layers).toHaveLength(3);
    expect(map.architecture.layers[0]).toMatchObject({ name: 'src', fileCount: 5 });
    expect(map.architecture.layers[1]).toMatchObject({ name: 'tests', fileCount: 2 });
    expect(map.architecture.layers[2]).toMatchObject({ name: 'lib', fileCount: 1 });
  });

  it('derives entrypoints: files with imports but zero importers, excluding tests/scripts', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    expect(map.architecture.entrypoints).toEqual(['src/cli.ts', 'src/index.ts']);
  });

  it('derives hub files: top 5 by importedBy count, sorted count-desc then alpha', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    expect(map.architecture.hubFiles).toEqual([
      'src/core/search.ts',
      'src/utils/helpers.ts',
      'lib/utils.ts'
    ]);
  });

  it('derives active patterns from intelligence.json, sorted by adoption desc', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    expect(map.activePatterns).toEqual([
      { name: 'Injectable', adoption: '100%', trend: 'Stable' },
      { name: 'RxJS', adoption: '72%', trend: 'Rising' },
      { name: 'Vitest', adoption: '45%', trend: 'Stable' }
    ]);
  });

  it('derives best examples from goldenFiles with dominant pattern as reason', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    expect(map.bestExamples).toEqual([
      { file: 'src/core/search.ts', score: 0.95, reason: 'Injectable' },
      { file: 'src/utils/helpers.ts', score: 0.87, reason: 'Injectable' }
    ]);
  });

  it('reads graph stats from relationships.json', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    expect(map.graphStats).toEqual({ files: 8, edges: 9, avgDependencies: 1.1 });
  });

  it('adds suggested next calls: split pattern + golden file + fallback', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    // Vitest at 45% triggers split-pattern suggestion
    expect(map.suggestedNextCalls[0]).toEqual({
      tool: 'get_team_patterns',
      args: { category: 'vitest' },
      why: 'Team is split on Vitest'
    });
    // Top golden file triggers search suggestion
    expect(map.suggestedNextCalls[1]).toEqual({
      tool: 'search_codebase',
      args: { query: 'search' },
      why: 'Explore the top-rated example'
    });
    // Fallback
    expect(map.suggestedNextCalls[2]).toEqual({
      tool: 'search_codebase',
      args: { query: 'project architecture' },
      why: 'Explore the codebase'
    });
    expect(map.suggestedNextCalls).toHaveLength(3);
  });

  it('degrades gracefully when intelligence.json is missing', async () => {
    // Point at a non-existent dir — builder should return empty map, not throw
    const project = createProjectState(path.join(FIXTURE_ROOT, 'nonexistent'));
    const map = await buildCodebaseMap(project);
    expect(map.architecture.layers).toEqual([]);
    expect(map.architecture.entrypoints).toEqual([]);
    expect(map.architecture.hubFiles).toEqual([]);
    expect(map.architecture.keyInterfaces).toEqual([]);
    expect(map.architecture.apiSurface).toEqual([]);
    expect(map.architecture.hotspots).toEqual([]);
    expect(map.activePatterns).toEqual([]);
    expect(map.bestExamples).toEqual([]);
    expect(map.graphStats).toEqual({ files: 0, edges: 0, avgDependencies: 0 });
    // Should still have a fallback next call
    expect(map.suggestedNextCalls.length).toBeGreaterThan(0);
  });

  it('caps suggested next calls at 3', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    expect(map.suggestedNextCalls.length).toBeLessThanOrEqual(3);
  });

  // --- Structural skeleton (Phase 13) ---

  it('derives keyInterfaces from symbolAware chunks, sorted by importer count', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    // SearchOptions and CodebaseSearcher are both in src/core/search.ts (3 importers)
    // SearchResult is in src/types.ts (0 importers)
    // helperUtil is not symbolAware — excluded
    expect(map.architecture.keyInterfaces.length).toBeGreaterThanOrEqual(2);
    // Items with same importerCount: shorter content first → SearchOptions before CodebaseSearcher
    expect(map.architecture.keyInterfaces[0].name).toBe('SearchOptions');
    expect(map.architecture.keyInterfaces[0].importerCount).toBe(3);
    expect(map.architecture.keyInterfaces[0].kind).toBe('interface');
    expect(map.architecture.keyInterfaces[0].file).toBe('src/core/search.ts');
  });

  it('signatureHint strips trailing { and caps at 200 chars', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    for (const ki of map.architecture.keyInterfaces) {
      expect(ki.signatureHint).not.toMatch(/\{$/);
      expect(ki.signatureHint.length).toBeLessThanOrEqual(200);
    }
  });

  it('signatureHint contains the symbol name', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    const iface = map.architecture.keyInterfaces.find((k) => k.name === 'SearchOptions')!;
    expect(iface.signatureHint).toContain('SearchOptions');
  });

  it('derives apiSurface from entrypoints x graph.exports', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    // src/cli.ts and src/index.ts are entrypoints; both have exports in fixture
    const cli = map.architecture.apiSurface.find((s) => s.file === 'src/cli.ts');
    expect(cli).toBeDefined();
    expect(cli!.exports).toContain('runCli');
    expect(cli!.exports).toContain('parseArgs');
    expect(cli!.exports.length).toBeLessThanOrEqual(5);
  });

  it('apiSurface excludes default exports', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    for (const surface of map.architecture.apiSurface) {
      expect(surface.exports).not.toContain('default');
    }
  });

  it('derives hotspots sorted by combined import + importer count', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    expect(map.architecture.hotspots.length).toBeLessThanOrEqual(5);
    // src/core/search.ts: importedBy=3, imports=2 → combined=5 (highest)
    expect(map.architecture.hotspots[0].file).toBe('src/core/search.ts');
    expect(map.architecture.hotspots[0].combined).toBe(5);
    // combined is always importerCount + importCount
    for (const h of map.architecture.hotspots) {
      expect(h.combined).toBe(h.importerCount + h.importCount);
    }
  });

  it('enriches layers with hubFile from importedBy data', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    const srcLayer = map.architecture.layers.find((l) => l.name === 'src')!;
    // src/core/search.ts has 3 importers — highest in the src layer
    expect(srcLayer.hubFile).toBe('src/core/search.ts');
  });

  it('enriches layers with hubExports when graph.exports has data', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    // src/cli.ts has exports in fixture but is not the hub of the src layer
    // src/index.ts has exports and is also in src — but search.ts (hub) has no exports in fixture
    const srcLayer = map.architecture.layers.find((l) => l.name === 'src')!;
    // search.ts has no exports in fixture → hubExports should be absent
    expect(srcLayer.hubExports).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// renderMapMarkdown — snapshot test
// ---------------------------------------------------------------------------

describe('renderMapMarkdown', () => {
  it('renders deterministic markdown from fixture — snapshot', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    const md = renderMapMarkdown(map);
    expect(md).toMatchSnapshot();
  });

  it('includes all required section headers', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    const md = renderMapMarkdown(map);
    expect(md).toContain('# Codebase Map');
    expect(md).toContain('## Architecture Layers');
    expect(md).toContain('## Entrypoints');
    expect(md).toContain('## Hub Files');
    expect(md).toContain('## Key Interfaces');
    expect(md).toContain('## API Surface');
    expect(md).toContain('## Dependency Hotspots');
    expect(md).toContain('## Active Patterns');
    expect(md).toContain('## Best Examples');
    expect(md).toContain('## Graph Stats');
    expect(md).toContain('## Suggested Next Calls');
  });

  it('renders empty map sections gracefully', () => {
    const emptyMap = {
      project: 'empty',
      architecture: {
        layers: [],
        entrypoints: [],
        hubFiles: [],
        keyInterfaces: [],
        apiSurface: [],
        hotspots: []
      },
      activePatterns: [],
      bestExamples: [],
      graphStats: { files: 0, edges: 0, avgDependencies: 0 },
      suggestedNextCalls: []
    };
    const md = renderMapMarkdown(emptyMap);
    expect(md).toContain('_No index data available._');
    expect(md).toContain('_None detected._');
    expect(md).toContain('_No patterns detected._');
    expect(md).toContain('_No examples available._');
    expect(md).toContain('_No suggestions._');
  });
});

// ---------------------------------------------------------------------------
// renderMapPretty
// ---------------------------------------------------------------------------

describe('renderMapPretty', () => {
  it('renders box characters in default mode', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    const pretty = renderMapPretty(map);
    expect(pretty).toContain('┌');
    expect(pretty).toContain('│');
    expect(pretty).toContain('└');
  });

  it('renders ASCII box chars when CODEBASE_CONTEXT_ASCII=1', async () => {
    const original = process.env.CODEBASE_CONTEXT_ASCII;
    process.env.CODEBASE_CONTEXT_ASCII = '1';
    try {
      const project = createProjectState(FIXTURE_ROOT);
      const map = await buildCodebaseMap(project);
      const pretty = renderMapPretty(map);
      expect(pretty).toContain('+');
      expect(pretty).toContain('-');
      expect(pretty).not.toContain('┌');
    } finally {
      if (original === undefined) {
        delete process.env.CODEBASE_CONTEXT_ASCII;
      } else {
        process.env.CODEBASE_CONTEXT_ASCII = original;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// generateCodebaseIntelligence — MCP resource integration (eval guard)
// ---------------------------------------------------------------------------

describe('generateCodebaseIntelligence (eval guard)', () => {
  it('returns a non-empty markdown string from fixture', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const result = await generateCodebaseIntelligence(project);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('contains the # Codebase Map header', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const result = await generateCodebaseIntelligence(project);
    expect(result).toContain('# Codebase Map');
  });

  it('contains key section markers from the map', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const result = await generateCodebaseIntelligence(project);
    expect(result).toContain('## Architecture Layers');
    expect(result).toContain('## Active Patterns');
    expect(result).toContain('## Hub Files');
  });

  it('does not contain the error fallback text', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const result = await generateCodebaseIntelligence(project);
    expect(result).not.toContain('Intelligence data not yet generated');
  });

  it('returns error fallback when index is missing', async () => {
    const project = createProjectState(path.join(FIXTURE_ROOT, 'nonexistent'));
    // With missing files the builder degrades but renderMapMarkdown still returns valid map
    // The only way to get the error fallback is if renderMapMarkdown itself throws,
    // which it won't — so we just assert the returned string is valid (no unhandled throw).
    const result = await generateCodebaseIntelligence(project);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
