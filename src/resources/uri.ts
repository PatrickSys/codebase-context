const CONTEXT_RESOURCE_URI = 'codebase://context';
const PROJECT_CONTEXT_RESOURCE_PREFIX = `${CONTEXT_RESOURCE_URI}/project/`;

export function normalizeResourceUri(uri: string): string {
  if (!uri) return uri;
  if (uri === CONTEXT_RESOURCE_URI) return uri;
  if (uri.endsWith(`/${CONTEXT_RESOURCE_URI}`)) return CONTEXT_RESOURCE_URI;
  const scopedMarker = `/${PROJECT_CONTEXT_RESOURCE_PREFIX}`;
  const scopedIndex = uri.indexOf(scopedMarker);
  if (scopedIndex >= 0) {
    return uri.slice(scopedIndex + 1);
  }
  return uri;
}

export function isContextResourceUri(uri: string): boolean {
  return normalizeResourceUri(uri) === CONTEXT_RESOURCE_URI;
}

export function buildProjectContextResourceUri(projectPath: string): string {
  return `${PROJECT_CONTEXT_RESOURCE_PREFIX}${encodeURIComponent(projectPath)}`;
}

export function getProjectPathFromContextResourceUri(uri: string): string | undefined {
  const normalized = normalizeResourceUri(uri);
  if (!normalized.startsWith(PROJECT_CONTEXT_RESOURCE_PREFIX)) {
    return undefined;
  }

  const encodedProjectPath = normalized.slice(PROJECT_CONTEXT_RESOURCE_PREFIX.length);
  return encodedProjectPath ? decodeURIComponent(encodedProjectPath) : undefined;
}

export { CONTEXT_RESOURCE_URI, PROJECT_CONTEXT_RESOURCE_PREFIX };
