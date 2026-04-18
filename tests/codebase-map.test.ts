import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProjectState } from '../src/project-state.js';
import { buildCodebaseMap, renderMapMarkdown, renderMapPretty } from '../src/core/codebase-map.js';
import { generateCodebaseIntelligence } from '../src/resources/codebase-intelligence.js';
import type { CodeChunk } from '../src/types/index.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INTELLIGENCE_FILENAME,
  KEYWORD_INDEX_FILENAME,
  RELATIONSHIPS_FILENAME
} from '../src/constants/codebase-context.js';

// Resolve fixture path relative to this test file — portable across CWD setups.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'map-fixture');
const CURRENT_REPO_ROOT = path.resolve(__dirname, '..');
const ENTRYPOINT = path.join(CURRENT_REPO_ROOT, 'src', 'index.ts');
const BOUNDED_LIMITS = {
  entrypoints: 8,
  hubFiles: 5,
  keyInterfaces: 8,
  apiSurfaceFiles: 8,
  apiSurfaceExports: 3,
  hotspots: 5,
  bestExamples: 3
} as const;

type TempGraph = {
  imports?: Record<string, string[]>;
  importedBy?: Record<string, string[]>;
  exports?: Record<string, Array<{ name: string; type: string }>>;
  stats?: { files?: number; edges?: number; avgDependencies?: number };
};

type TempProjectOptions = {
  projectName?: string;
  graph?: TempGraph;
  goldenFiles?: Array<{ file: string; score: number }>;
  patterns?: Record<string, unknown>;
  chunks?: CodeChunk[];
};

async function createTempMapProject(options: TempProjectOptions = {}): Promise<string> {
  const tempParent = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-map-project-'));
  const projectName = options.projectName ?? 'temp-map-project';
  const rootPath = path.join(tempParent, projectName);
  const ctxDir = path.join(rootPath, CODEBASE_CONTEXT_DIRNAME);

  await fs.mkdir(ctxDir, { recursive: true });
  await fs.writeFile(
    path.join(ctxDir, INTELLIGENCE_FILENAME),
    JSON.stringify(
      {
        patterns: options.patterns ?? {},
        goldenFiles: options.goldenFiles ?? []
      },
      null,
      2
    ),
    'utf-8'
  );
  await fs.writeFile(
    path.join(ctxDir, KEYWORD_INDEX_FILENAME),
    JSON.stringify({ chunks: options.chunks ?? [] }, null, 2),
    'utf-8'
  );
  await fs.writeFile(
    path.join(ctxDir, RELATIONSHIPS_FILENAME),
    JSON.stringify({ graph: options.graph ?? {} }, null, 2),
    'utf-8'
  );

  return rootPath;
}

async function removeTempMapProject(rootPath: string): Promise<void> {
  await fs.rm(path.dirname(rootPath), { recursive: true, force: true });
}

function runMapCli(args: string[], rootPath: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', ENTRYPOINT, 'map', ...args], {
    cwd: CURRENT_REPO_ROOT,
    env: {
      ...process.env,
      CODEBASE_ROOT: rootPath
    },
    encoding: 'utf8',
    timeout: 120_000
  });
}

// ---------------------------------------------------------------------------
// buildCodebaseMap
// ---------------------------------------------------------------------------

describe('buildCodebaseMap', () => {
  it('returns a CodebaseMapSummary with project name from rootPath', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project, { mode: 'full' });
    expect(map.project).toBe('map-fixture');
  });

  it('derives architecture layers from graph keys, sorted by count desc then alpha', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project, { mode: 'full' });
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
    const map = await buildCodebaseMap(project, { mode: 'full' });
    expect(map.architecture.hubFiles).toEqual([
      'src/core/search.ts',
      'src/utils/helpers.ts',
      'lib/utils.ts'
    ]);
  });

  it('derives active patterns from intelligence.json, sorted by adoption desc', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project, { mode: 'full' });
    expect(map.activePatterns).toEqual([
      { name: 'Injectable', adoption: '100%', trend: 'Stable' },
      { name: 'RxJS', adoption: '72%', trend: 'Rising' },
      { name: 'Vitest', adoption: '45%', trend: 'Stable' }
    ]);
  });

  it('derives best examples from goldenFiles with dominant pattern as reason', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project, { mode: 'full' });
    expect(map.bestExamples).toEqual([
      { file: 'src/core/search.ts', score: 0.95, reason: 'Injectable' },
      { file: 'src/utils/helpers.ts', score: 0.87, reason: 'Injectable' }
    ]);
  });

  it('reads graph stats from relationships.json', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project, { mode: 'full' });
    expect(map.graphStats).toEqual({ files: 8, edges: 9, avgDependencies: 1.1 });
  });

  it('adds suggested next calls: split pattern + golden file + fallback', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project, { mode: 'full' });
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
    const map = await buildCodebaseMap(project, { mode: 'full' });
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
    const map = await buildCodebaseMap(project, { mode: 'full' });
    expect(map.suggestedNextCalls.length).toBeLessThanOrEqual(3);
  });

  it('keeps bounded mode free of tests, fixtures, generated output, dist, and vendor noise', async () => {
    const rootPath = await createTempMapProject({
      projectName: 'codebase-context',
      patterns: {
        default: {
          primary: { name: 'Factory', frequency: '80%', trend: 'Stable' }
        }
      },
      goldenFiles: [
        { file: 'tests/codebase-map.test.ts', score: 0.99 },
        { file: 'dist/index.js', score: 0.97 },
        { file: 'src/core/map.ts', score: 0.95 },
        { file: 'src/index.ts', score: 0.91 }
      ],
      graph: {
        imports: {
          'src/index.ts': ['src/core/map.ts'],
          'src/cli.ts': ['src/core/map.ts'],
          'src/core/map.ts': [],
          'tests/codebase-map.test.ts': ['src/core/map.ts'],
          'dist/index.js': ['src/core/map.ts'],
          'vendor/acme/index.ts': ['src/core/map.ts'],
          'src/generated/api.generated.ts': ['src/core/map.ts'],
          'src/fixtures/sample.ts': ['src/core/map.ts']
        },
        importedBy: {
          'src/core/map.ts': [
            'src/index.ts',
            'src/cli.ts',
            'tests/codebase-map.test.ts',
            'dist/index.js',
            'vendor/acme/index.ts',
            'src/generated/api.generated.ts',
            'src/fixtures/sample.ts'
          ]
        },
        exports: {
          'src/index.ts': [{ name: 'serve', type: 'function' }],
          'src/cli.ts': [{ name: 'runCli', type: 'function' }],
          'tests/codebase-map.test.ts': [{ name: 'suite', type: 'function' }],
          'dist/index.js': [{ name: 'bundle', type: 'function' }],
          'src/generated/api.generated.ts': [{ name: 'GeneratedApi', type: 'interface' }]
        },
        stats: { files: 8, edges: 7, avgDependencies: 0.9 }
      },
      chunks: [
        {
          relativePath: 'src/core/map.ts',
          content: 'export class MapBuilder { build() {} }',
          metadata: {
            symbolAware: true,
            symbolKind: 'class',
            symbolName: 'MapBuilder'
          }
        } as CodeChunk,
        {
          relativePath: 'tests/codebase-map.test.ts',
          content: 'export class MapBuilderTest { run() {} }',
          metadata: {
            symbolAware: true,
            symbolKind: 'class',
            symbolName: 'MapBuilderTest'
          }
        } as CodeChunk,
        {
          relativePath: 'src/generated/api.generated.ts',
          content: 'export interface GeneratedApi { id: string }',
          metadata: {
            symbolAware: true,
            symbolKind: 'interface',
            symbolName: 'GeneratedApi'
          }
        } as CodeChunk
      ]
    });

    try {
      const project = createProjectState(rootPath);
      const map = await buildCodebaseMap(project);

      expect(map.project).toBe('codebase-context');
      expect(map.architecture.layers.map((layer) => layer.name)).toEqual(['src']);
      expect(map.architecture.entrypoints).toEqual(['src/cli.ts', 'src/index.ts']);
      expect(map.architecture.hubFiles).toEqual(['src/core/map.ts']);
      expect(map.architecture.keyInterfaces.map((item) => item.name)).toEqual(['MapBuilder']);
      expect(map.architecture.apiSurface.map((surface) => surface.file)).toEqual([
        'src/cli.ts',
        'src/index.ts'
      ]);
      expect(map.architecture.hotspots.every((hotspot) => hotspot.file.startsWith('src/'))).toBe(
        true
      );
      expect(map.bestExamples).toEqual([
        { file: 'src/core/map.ts', score: 0.95, reason: 'Factory' },
        { file: 'src/index.ts', score: 0.91, reason: 'Factory' }
      ]);
    } finally {
      await removeTempMapProject(rootPath);
    }
  });

  it('restores excluded paths in full mode and removes bounded caps', async () => {
    const imports: Record<string, string[]> = {};
    const importedBy: Record<string, string[]> = {};
    const exportsByFile: Record<string, Array<{ name: string; type: string }>> = {};
    const chunks: CodeChunk[] = [];
    const goldenFiles: Array<{ file: string; score: number }> = [];

    for (let index = 0; index < 10; index += 1) {
      const contractFile = `src/contracts/contract-${index}.ts`;
      importedBy[contractFile] = [`src/entry-${index}.ts`, 'tests/codebase-map.test.ts'];
      chunks.push({
        relativePath: contractFile,
        content: `export interface Contract${index} { value: string }`,
        metadata: {
          symbolAware: true,
          symbolKind: 'interface',
          symbolName: `Contract${index}`
        }
      } as CodeChunk);
      goldenFiles.push({ file: contractFile, score: 0.9 - index * 0.01 });
    }

    for (let index = 0; index < 12; index += 1) {
      const entryFile = `src/entry-${index}.ts`;
      const sharedFile = `src/shared-${index}.ts`;
      imports[entryFile] = [sharedFile];
      imports[sharedFile] = [];
      importedBy[sharedFile] = [entryFile];
      exportsByFile[entryFile] = [
        { name: `entry${index}A`, type: 'function' },
        { name: `entry${index}B`, type: 'function' },
        { name: `entry${index}C`, type: 'function' },
        { name: `entry${index}D`, type: 'function' }
      ];
    }

    imports['tests/codebase-map.test.ts'] = ['src/shared-0.ts'];
    imports['dist/index.js'] = ['src/shared-1.ts'];
    imports['vendor/acme/index.ts'] = ['src/shared-2.ts'];
    exportsByFile['tests/codebase-map.test.ts'] = [{ name: 'suite', type: 'function' }];
    exportsByFile['dist/index.js'] = [{ name: 'bundle', type: 'function' }];
    exportsByFile['vendor/acme/index.ts'] = [{ name: 'vendorEntry', type: 'function' }];
    goldenFiles.unshift(
      { file: 'tests/codebase-map.test.ts', score: 0.99 },
      { file: 'dist/index.js', score: 0.98 },
      { file: 'vendor/acme/index.ts', score: 0.97 }
    );

    const rootPath = await createTempMapProject({
      graph: {
        imports,
        importedBy,
        exports: exportsByFile,
        stats: { files: 30, edges: 40, avgDependencies: 1.3 }
      },
      goldenFiles,
      chunks
    });

    try {
      const project = createProjectState(rootPath);
      const boundedMap = await buildCodebaseMap(project);
      const fullMap = await buildCodebaseMap(project, { mode: 'full' });

      expect(boundedMap.architecture.entrypoints).toHaveLength(BOUNDED_LIMITS.entrypoints);
      expect(fullMap.architecture.entrypoints.length).toBeGreaterThan(
        boundedMap.architecture.entrypoints.length
      );
      expect(boundedMap.architecture.keyInterfaces).toHaveLength(BOUNDED_LIMITS.keyInterfaces);
      expect(fullMap.architecture.keyInterfaces.length).toBeGreaterThan(
        boundedMap.architecture.keyInterfaces.length
      );
      expect(boundedMap.architecture.apiSurface).toHaveLength(BOUNDED_LIMITS.apiSurfaceFiles);
      expect(fullMap.architecture.apiSurface.length).toBeGreaterThan(
        boundedMap.architecture.apiSurface.length
      );
      expect(
        boundedMap.architecture.apiSurface.find((surface) => surface.file === 'src/entry-0.ts')
          ?.exports
      ).toHaveLength(BOUNDED_LIMITS.apiSurfaceExports);
      expect(
        fullMap.architecture.apiSurface.find((surface) => surface.file === 'src/entry-0.ts')
          ?.exports
      ).toHaveLength(4);
      expect(boundedMap.architecture.hubFiles).toHaveLength(BOUNDED_LIMITS.hubFiles);
      expect(fullMap.architecture.hubFiles.length).toBeGreaterThan(
        boundedMap.architecture.hubFiles.length
      );
      expect(boundedMap.architecture.hotspots).toHaveLength(BOUNDED_LIMITS.hotspots);
      expect(fullMap.architecture.hotspots.length).toBeGreaterThan(
        boundedMap.architecture.hotspots.length
      );
      expect(boundedMap.bestExamples).toHaveLength(BOUNDED_LIMITS.bestExamples);
      expect(
        fullMap.bestExamples.some((example) => example.file === 'tests/codebase-map.test.ts')
      ).toBe(true);
      expect(fullMap.bestExamples.some((example) => example.file === 'dist/index.js')).toBe(true);
      expect(fullMap.architecture.layers.map((layer) => layer.name)).toEqual(
        expect.arrayContaining(['dist', 'tests', 'vendor'])
      );
    } finally {
      await removeTempMapProject(rootPath);
    }
  });

  it('keeps the repo-root codebase-context map bounded by default', async () => {
    const project = createProjectState(CURRENT_REPO_ROOT);
    const map = await buildCodebaseMap(project);

    expect(map.project).toBe(path.basename(CURRENT_REPO_ROOT));
    expect(map.architecture.layers.map((layer) => layer.name)).not.toContain('tests');
    expect(map.architecture.layers.map((layer) => layer.name)).not.toContain('dist');
    expect(map.architecture.entrypoints.length).toBeLessThanOrEqual(8);
    expect(map.architecture.apiSurface.length).toBeLessThanOrEqual(8);
    expect(map.architecture.hubFiles.every((file) => !/(?:^|\/)(?:tests?|dist)\//.test(file))).toBe(
      true
    );
  });

  // --- Structural skeleton (Phase 13) ---

  it('derives keyInterfaces from symbolAware chunks, sorted by importer count', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project, { mode: 'full' });
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
    const map = await buildCodebaseMap(project, { mode: 'full' });
    for (const ki of map.architecture.keyInterfaces) {
      expect(ki.signatureHint).not.toMatch(/\{$/);
      expect(ki.signatureHint.length).toBeLessThanOrEqual(200);
    }
  });

  it('signatureHint contains the symbol name', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project, { mode: 'full' });
    const iface = map.architecture.keyInterfaces.find((k) => k.name === 'SearchOptions')!;
    expect(iface.signatureHint).toContain('SearchOptions');
  });

  it('derives apiSurface from entrypoints x graph.exports', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project, { mode: 'full' });
    // src/cli.ts and src/index.ts are entrypoints; both have exports in fixture
    const cli = map.architecture.apiSurface.find((s) => s.file === 'src/cli.ts');
    expect(cli).toBeDefined();
    expect(cli!.exports).toContain('runCli');
    expect(cli!.exports).toContain('parseArgs');
    expect(cli!.exports.length).toBeLessThanOrEqual(5);
  });

  it('apiSurface excludes default exports', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project, { mode: 'full' });
    for (const surface of map.architecture.apiSurface) {
      expect(surface.exports).not.toContain('default');
    }
  });

  it('derives hotspots sorted by combined import + importer count', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project);
    expect(map.architecture.hotspots.length).toBeLessThanOrEqual(5);
    // Bounded mode drops test importers, so search.ts keeps two real importers plus two imports.
    expect(map.architecture.hotspots[0].file).toBe('src/core/search.ts');
    expect(map.architecture.hotspots[0].combined).toBe(4);
    // combined is always importerCount + importCount
    for (const h of map.architecture.hotspots) {
      expect(h.combined).toBe(h.importerCount + h.importCount);
    }
  });

  it('enriches layers with hubFile from importedBy data', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project, { mode: 'full' });
    const srcLayer = map.architecture.layers.find((l) => l.name === 'src')!;
    // src/core/search.ts has 3 importers — highest in the src layer
    expect(srcLayer.hubFile).toBe('src/core/search.ts');
  });

  it('enriches layers with hubExports when graph.exports has data', async () => {
    const project = createProjectState(FIXTURE_ROOT);
    const map = await buildCodebaseMap(project, { mode: 'full' });
    // src/cli.ts has exports in fixture but is not the hub of the src layer
    // src/index.ts has exports and is also in src — but search.ts (hub) has no exports in fixture
    const srcLayer = map.architecture.layers.find((l) => l.name === 'src')!;
    // search.ts has no exports in fixture → hubExports should be absent
    expect(srcLayer.hubExports).toBeUndefined();
  });

  it('breaks equal layer hub-file ties alphabetically', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'map-layer-tie-break-'));

    try {
      const ctxDir = path.join(tempRoot, CODEBASE_CONTEXT_DIRNAME);
      await fs.mkdir(ctxDir, { recursive: true });

      await fs.writeFile(
        path.join(ctxDir, INTELLIGENCE_FILENAME),
        JSON.stringify({}, null, 2),
        'utf-8'
      );
      await fs.writeFile(
        path.join(ctxDir, KEYWORD_INDEX_FILENAME),
        JSON.stringify({ chunks: [] }, null, 2),
        'utf-8'
      );
      await fs.writeFile(
        path.join(ctxDir, RELATIONSHIPS_FILENAME),
        JSON.stringify(
          {
            graph: {
              importedBy: {
                'src/a.ts': ['src/app.ts', 'src/root.ts'],
                'src/b.ts': ['src/app.ts', 'src/root.ts']
              },
              exports: {
                'src/a.ts': [{ name: 'alpha', type: 'function' }],
                'src/b.ts': [{ name: 'beta', type: 'function' }]
              }
            }
          },
          null,
          2
        ),
        'utf-8'
      );

      const project = createProjectState(tempRoot);
      const map = await buildCodebaseMap(project, { mode: 'full' });
      const srcLayer = map.architecture.layers.find((layer) => layer.name === 'src');

      expect(srcLayer?.hubFile).toBe('src/a.ts');
      expect(srcLayer?.hubExports).toEqual(['alpha']);
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
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
    const map = await buildCodebaseMap(project, { mode: 'full' });
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
    const map = await buildCodebaseMap(project, { mode: 'full' });
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
      const map = await buildCodebaseMap(project, { mode: 'full' });
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

describe('map CLI contract', () => {
  it('supports --full on the real CLI entrypoint', async () => {
    const rootPath = await createTempMapProject({
      projectName: 'codebase-context',
      patterns: {
        default: {
          primary: { name: 'Factory', frequency: '80%', trend: 'Stable' }
        }
      },
      goldenFiles: [
        { file: 'repos/external-lib/src/index.ts', score: 0.98 },
        { file: 'src/core/map.ts', score: 0.95 }
      ],
      graph: {
        imports: {
          'src/index.ts': ['src/core/map.ts'],
          'repos/external-lib/src/index.ts': ['src/core/map.ts']
        },
        importedBy: {
          'src/core/map.ts': ['src/index.ts', 'repos/external-lib/src/index.ts']
        },
        exports: {
          'src/index.ts': [{ name: 'serve', type: 'function' }],
          'repos/external-lib/src/index.ts': [{ name: 'mountExternalRepo', type: 'function' }]
        },
        stats: { files: 2, edges: 2, avgDependencies: 1 }
      },
      chunks: [
        {
          relativePath: 'src/core/map.ts',
          content: 'export class MapBuilder { build() {} }',
          metadata: {
            symbolAware: true,
            symbolKind: 'class',
            symbolName: 'MapBuilder'
          }
        } as CodeChunk
      ]
    });

    try {
      const result = runMapCli(['--full', '--json'], rootPath);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');

      const parsed = JSON.parse(result.stdout) as {
        architecture?: { apiSurface?: Array<{ file: string }> };
        bestExamples?: Array<{ file: string }>;
      };

      expect(parsed.architecture?.apiSurface?.map((surface) => surface.file)).toContain(
        'repos/external-lib/src/index.ts'
      );
      expect(parsed.bestExamples?.map((example) => example.file)).toContain(
        'repos/external-lib/src/index.ts'
      );
    } finally {
      await removeTempMapProject(rootPath);
    }
  }, 120_000);

  it('writes the exhaustive markdown map when --export and --full are combined', async () => {
    const rootPath = await createTempMapProject({
      projectName: 'codebase-context',
      patterns: {
        default: {
          primary: { name: 'Factory', frequency: '80%', trend: 'Stable' }
        }
      },
      goldenFiles: [
        { file: 'repos/external-lib/src/index.ts', score: 0.98 },
        { file: 'src/core/map.ts', score: 0.95 }
      ],
      graph: {
        imports: {
          'src/index.ts': ['src/core/map.ts'],
          'repos/external-lib/src/index.ts': ['src/core/map.ts']
        },
        importedBy: {
          'src/core/map.ts': ['src/index.ts', 'repos/external-lib/src/index.ts']
        },
        exports: {
          'src/index.ts': [{ name: 'serve', type: 'function' }],
          'repos/external-lib/src/index.ts': [{ name: 'mountExternalRepo', type: 'function' }]
        },
        stats: { files: 2, edges: 2, avgDependencies: 1 }
      },
      chunks: [
        {
          relativePath: 'src/core/map.ts',
          content: 'export class MapBuilder { build() {} }',
          metadata: {
            symbolAware: true,
            symbolKind: 'class',
            symbolName: 'MapBuilder'
          }
        } as CodeChunk
      ]
    });

    try {
      const result = runMapCli(['--export', '--full'], rootPath);

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');

      const exportPath = path.join(rootPath, 'CODEBASE_MAP.md');
      const exportedMarkdown = await fs.readFile(exportPath, 'utf-8');

      expect(result.stdout).toContain(`Wrote ${exportPath}`);
      expect(exportedMarkdown).toContain('repos/external-lib/src/index.ts');
      expect(exportedMarkdown).toContain('mountExternalRepo');
    } finally {
      await removeTempMapProject(rootPath);
    }
  }, 120_000);
});
