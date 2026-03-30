/**
 * Language Detection Utilities
 * Determines file types and languages based on extension and content
 */

import path from 'path';

// Map of file extensions to languages
const extensionToLanguage: Record<string, string> = {
  // JavaScript/TypeScript
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascriptreact',
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.mts': 'typescript',
  '.cts': 'typescript',

  // Web
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',

  // Data/Config
  '.json': 'json',
  '.jsonc': 'jsonc',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',

  // Markdown
  '.md': 'markdown',
  '.mdx': 'mdx',

  // Other
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.sql': 'sql',
  '.sh': 'shellscript',
  '.bash': 'shellscript',
  '.zsh': 'shellscript',
  '.ps1': 'powershell',
  '.py': 'python',
  '.pyi': 'python',
  '.rb': 'ruby',
  '.php': 'php',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.go': 'go',
  '.rs': 'rust',
  '.cs': 'csharp',
  '.swift': 'swift',
  '.scala': 'scala',
  '.c': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp'
};

// Binary file extensions to skip
const binaryExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.svg',
  '.webp',
  '.bmp',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.mp3',
  '.mp4',
  '.wav',
  '.avi',
  '.mov',
  '.webm',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.zip',
  '.tar',
  '.gz',
  '.rar',
  '.7z',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.lock',
  '.map'
]);

const baseCodeExtensions = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.json',
  '.jsonc',
  '.yaml',
  '.yml',
  '.md',
  '.mdx',
  '.graphql',
  '.gql',
  '.toml',
  '.xml',
  '.py',
  '.pyi',
  '.rb',
  '.php',
  '.java',
  '.kt',
  '.kts',
  '.go',
  '.rs',
  '.cs',
  '.swift',
  '.scala',
  '.c',
  '.cpp',
  '.cc',
  '.cxx',
  '.h',
  '.hpp',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.sql'
]);

function normalizeExtension(extension: string): string | null {
  const trimmed = extension.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

function buildCodeExtensions(extraExtensions?: Iterable<string>): Set<string> {
  const merged = new Set(baseCodeExtensions);
  for (const extension of extraExtensions ?? []) {
    const normalized = normalizeExtension(extension);
    if (normalized) {
      merged.add(normalized);
    }
  }
  return merged;
}

// Cached default set — built once at module load, reused by callers that pass no extra extensions.
const defaultCodeExtensions: ReadonlySet<string> = buildCodeExtensions();

/**
 * Detect language from file path
 */
export function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return extensionToLanguage[ext] || 'plaintext';
}

/**
 * Check if a file is a code file
 */
export function isCodeFile(
  filePath: string,
  extensions?: Iterable<string> | ReadonlySet<string>
): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const supportedExtensions =
    extensions instanceof Set
      ? extensions
      : extensions
        ? buildCodeExtensions(extensions)
        : defaultCodeExtensions;
  return supportedExtensions.has(ext);
}

/**
 * Check if a file is binary
 */
export function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return binaryExtensions.has(ext);
}

/**
 * Check if file is a test file
 */
export function isTestFile(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return (
    lowerPath.includes('.spec.') ||
    lowerPath.includes('.test.') ||
    lowerPath.includes('__tests__') ||
    lowerPath.includes('/test/') ||
    lowerPath.includes('/tests/')
  );
}

/**
 * Check if file is a style guide or documentation
 */
export function isDocumentationFile(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  const fileName = path.basename(lowerPath);

  return (
    fileName === 'readme.md' ||
    fileName === 'contributing.md' ||
    fileName === 'changelog.md' ||
    fileName === 'license.md' ||
    fileName === 'style_guide.md' ||
    fileName === 'style-guide.md' ||
    fileName === 'architecture.md' ||
    lowerPath.includes('/docs/')
  );
}

/**
 * Get all supported extensions
 */
export function getSupportedExtensions(extraExtensions?: Iterable<string>): string[] {
  return Array.from(buildCodeExtensions(extraExtensions));
}
