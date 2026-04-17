const CONTEXT_RESOURCE_URI = 'codebase://context';
const PROJECT_CONTEXT_RESOURCE_PREFIX = `${CONTEXT_RESOURCE_URI}/project/`;
const FULL_CONTEXT_RESOURCE_URI = `${CONTEXT_RESOURCE_URI}/full`;
const FULL_PROJECT_CONTEXT_RESOURCE_PREFIX = `${FULL_CONTEXT_RESOURCE_URI}/project/`;

export function normalizeResourceUri(uri: string): string {
  if (!uri) return uri;
  const resourceIndex = uri.indexOf(CONTEXT_RESOURCE_URI);
  if (resourceIndex >= 0) {
    return uri.slice(resourceIndex);
  }
  return uri;
}

export function isContextResourceUri(uri: string): boolean {
  return normalizeResourceUri(uri) === CONTEXT_RESOURCE_URI;
}

export function isFullContextResourceUri(uri: string): boolean {
  return normalizeResourceUri(uri) === FULL_CONTEXT_RESOURCE_URI;
}

export function buildProjectContextResourceUri(projectPath: string): string {
  return `${PROJECT_CONTEXT_RESOURCE_PREFIX}${encodeURIComponent(projectPath)}`;
}

export function buildProjectFullContextResourceUri(projectPath: string): string {
  return `${FULL_PROJECT_CONTEXT_RESOURCE_PREFIX}${encodeURIComponent(projectPath)}`;
}

export function getProjectPathFromContextResourceUri(uri: string): string | undefined {
  const normalized = normalizeResourceUri(uri);
  if (!normalized.startsWith(PROJECT_CONTEXT_RESOURCE_PREFIX)) {
    return undefined;
  }

  const encodedProjectPath = normalized.slice(PROJECT_CONTEXT_RESOURCE_PREFIX.length);
  return encodedProjectPath ? decodeURIComponent(encodedProjectPath) : undefined;
}

export function getProjectPathFromFullContextResourceUri(uri: string): string | undefined {
  const normalized = normalizeResourceUri(uri);
  if (!normalized.startsWith(FULL_PROJECT_CONTEXT_RESOURCE_PREFIX)) {
    return undefined;
  }

  const encodedProjectPath = normalized.slice(FULL_PROJECT_CONTEXT_RESOURCE_PREFIX.length);
  return encodedProjectPath ? decodeURIComponent(encodedProjectPath) : undefined;
}

export {
  CONTEXT_RESOURCE_URI,
  PROJECT_CONTEXT_RESOURCE_PREFIX,
  FULL_CONTEXT_RESOURCE_URI,
  FULL_PROJECT_CONTEXT_RESOURCE_PREFIX
};
