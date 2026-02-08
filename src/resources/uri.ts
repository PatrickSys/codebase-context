const CONTEXT_RESOURCE_URI = 'codebase://context';

export function normalizeResourceUri(uri: string): string {
  if (!uri) return uri;
  if (uri === CONTEXT_RESOURCE_URI) return uri;
  if (uri.endsWith(`/${CONTEXT_RESOURCE_URI}`)) return CONTEXT_RESOURCE_URI;
  return uri;
}

export function isContextResourceUri(uri: string): boolean {
  return normalizeResourceUri(uri) === CONTEXT_RESOURCE_URI;
}

export { CONTEXT_RESOURCE_URI };
