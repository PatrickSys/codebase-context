import path from 'path';

export type EvalMode = 'retrieval' | 'discovery' | 'edit-preflight';

export interface EvalFixtureDefaults {
  fixtureA: string;
  fixtureB: string;
}

export function resolveEvalMode(rawMode: string | undefined): EvalMode {
  if (rawMode === 'discovery' || rawMode === 'edit-preflight') {
    return rawMode;
  }

  return 'retrieval';
}

export function getDefaultFixturePaths(projectRoot: string, mode: EvalMode): EvalFixtureDefaults {
  if (mode === 'discovery') {
    return {
      fixtureA: path.join(projectRoot, 'tests', 'fixtures', 'discovery-angular-spotify.json'),
      fixtureB: path.join(projectRoot, 'tests', 'fixtures', 'discovery-excalidraw.json')
    };
  }

  if (mode === 'edit-preflight') {
    return {
      fixtureA: path.join(projectRoot, 'tests', 'fixtures', 'edit-preflight-angular-spotify.json'),
      fixtureB: path.join(projectRoot, 'tests', 'fixtures', 'edit-preflight-excalidraw.json')
    };
  }

  return {
    fixtureA: path.join(projectRoot, 'tests', 'fixtures', 'eval-angular-spotify.json'),
    fixtureB: path.join(projectRoot, 'tests', 'fixtures', 'eval-controlled.json')
  };
}
