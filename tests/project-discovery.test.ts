import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  discoverProjectsWithinRoot,
  findNearestProjectBoundary,
  isPathWithin
} from '../src/utils/project-discovery.js';
import {
  CODEBASE_CONTEXT_DIRNAME
} from '../src/constants/codebase-context.js';

describe('project-discovery', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'project-discovery-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('discovers trusted-root subprojects with generic markers', async () => {
    const apiProject = path.join(tempRoot, 'services', 'api');
    const workerProject = path.join(tempRoot, 'packages', 'worker');
    const dotnetProject = path.join(tempRoot, 'apps', 'desktop');

    await fs.mkdir(path.join(apiProject, '.git'), { recursive: true });
    await fs.mkdir(path.join(workerProject, '.codebase-context'), { recursive: true });
    await fs.mkdir(dotnetProject, { recursive: true });
    await fs.writeFile(path.join(dotnetProject, 'Desktop.csproj'), '<Project />', 'utf-8');

    const discovered = await discoverProjectsWithinRoot(tempRoot);

    expect(discovered.map((entry) => entry.rootPath)).toEqual([
      dotnetProject,
      workerProject,
      apiProject
    ]);
    expect(discovered.map((entry) => entry.evidence)).toEqual([
      'project_manifest',
      'existing_index',
      'repo_root'
    ]);
  });

  it('treats existing .codebase-context directories as discoverable projects', async () => {
    const initializedProject = path.join(tempRoot, 'apps', 'initialized');

    await fs.mkdir(path.join(initializedProject, CODEBASE_CONTEXT_DIRNAME), { recursive: true });

    const discovered = await discoverProjectsWithinRoot(tempRoot);

    expect(discovered).toEqual([
      {
        rootPath: initializedProject,
        evidence: 'existing_index'
      }
    ]);
  });

  it('ignores vendor/build directories during discovery', async () => {
    const ignoredProject = path.join(tempRoot, 'node_modules', 'some-package');
    const realProject = path.join(tempRoot, 'apps', 'web');

    await fs.mkdir(ignoredProject, { recursive: true });
    await fs.writeFile(path.join(ignoredProject, 'package.json'), JSON.stringify({ name: 'ignored' }));

    await fs.mkdir(realProject, { recursive: true });
    await fs.writeFile(path.join(realProject, 'package.json'), JSON.stringify({ name: 'web' }));

    const discovered = await discoverProjectsWithinRoot(tempRoot);

    expect(discovered.map((entry) => entry.rootPath)).toEqual([realProject]);
  });

  it('finds the nearest project boundary for a file path', async () => {
    const projectRoot = path.join(tempRoot, 'apps', 'dashboard');
    const filePath = path.join(projectRoot, 'src', 'auth', 'guard.ts');

    await fs.mkdir(path.join(projectRoot, 'src', 'auth'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'pyproject.toml'), '[project]\nname = "dashboard"\n');
    await fs.writeFile(filePath, 'export const guard = true;\n');

    const discovered = await findNearestProjectBoundary(filePath, tempRoot);

    expect(discovered).toEqual({
      rootPath: projectRoot,
      evidence: 'project_manifest'
    });
  });

  it('does not escape the trusted root while resolving a boundary', async () => {
    const outsideProject = await fs.mkdtemp(path.join(os.tmpdir(), 'outside-project-'));
    try {
      await fs.writeFile(path.join(outsideProject, 'go.mod'), 'module example.com/outside\n');
      const result = await findNearestProjectBoundary(
        path.join(outsideProject, 'main.go'),
        tempRoot
      );
      expect(result).toBeUndefined();
    } finally {
      await fs.rm(outsideProject, { recursive: true, force: true });
    }
  });

  it('detects path containment safely', () => {
    expect(isPathWithin('/repo', '/repo/apps/web')).toBe(true);
    expect(isPathWithin('/repo', '/repo')).toBe(true);
    expect(isPathWithin('/repo', '/repo-other')).toBe(false);
  });
});
