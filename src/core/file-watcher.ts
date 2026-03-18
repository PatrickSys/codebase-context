import chokidar from 'chokidar';
import path from 'path';
import { EXCLUDED_GLOB_PATTERNS } from '../constants/codebase-context.js';
import { getSupportedExtensions } from '../utils/language-detection.js';

export interface FileWatcherOptions {
  rootPath: string;
  /** ms after last change before triggering. Default: 2000 */
  debounceMs?: number;
  /** Called once chokidar finishes initial scan and starts emitting change events */
  onReady?: () => void;
  /** Called once the debounce window expires after the last detected change */
  onChanged: () => void;
}

const TRACKED_EXTENSIONS = new Set(
  getSupportedExtensions().map((extension) => extension.toLowerCase())
);

const TRACKED_METADATA_FILES = new Set(['.gitignore']);

function isTrackedSourcePath(filePath: string): boolean {
  const basename = path.basename(filePath).toLowerCase();
  if (TRACKED_METADATA_FILES.has(basename)) return true;
  const extension = path.extname(filePath).toLowerCase();
  return extension.length > 0 && TRACKED_EXTENSIONS.has(extension);
}

/**
 * Watch rootPath for source file changes and call onChanged (debounced).
 * Returns a stop() function that cancels the debounce timer and closes the watcher.
 */
export function startFileWatcher(opts: FileWatcherOptions): () => void {
  const { rootPath, debounceMs = 2000, onReady, onChanged } = opts;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const trigger = (filePath: string) => {
    if (!isTrackedSourcePath(filePath)) return;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      onChanged();
    }, debounceMs);
  };

  const watcher = chokidar.watch(rootPath, {
    ignored: [...EXCLUDED_GLOB_PATTERNS],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
  });

  watcher
    .on('ready', () => onReady?.())
    .on('add', trigger)
    .on('change', trigger)
    .on('unlink', trigger)
    .on('error', (err: unknown) => console.error('[file-watcher] error:', err));

  return () => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    void watcher.close();
  };
}
