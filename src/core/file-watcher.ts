import chokidar from 'chokidar';
import path from 'path';
import { EXCLUDED_DIRECTORY_NAMES } from '../constants/codebase-context.js';
import { getSupportedExtensions } from '../utils/language-detection.js';

export interface FileWatcherOptions {
  rootPath: string;
  /** ms after last change before triggering. Default: 2000 */
  debounceMs?: number;
  /** Additional source extensions tracked for this project only. */
  extraExtensions?: string[];
  /** Called once chokidar finishes initial scan and starts emitting change events */
  onReady?: () => void;
  /** Called once the debounce window expires after the last detected change */
  onChanged: () => void;
}

const TRACKED_METADATA_FILES = new Set(['.gitignore']);

function isTrackedSourcePath(filePath: string, trackedExtensions: Set<string>): boolean {
  const basename = path.basename(filePath).toLowerCase();
  if (TRACKED_METADATA_FILES.has(basename)) return true;

  const extension = path.extname(filePath).toLowerCase();
  return extension.length > 0 && trackedExtensions.has(extension);
}

/**
 * Watch rootPath for source file changes and call onChanged (debounced).
 * Returns a stop() function that cancels pending work and resolves when the watcher closes.
 */
export function startFileWatcher(opts: FileWatcherOptions): () => Promise<void> {
  const { rootPath, debounceMs = 2000, extraExtensions, onReady, onChanged } = opts;
  const trackedExtensions = new Set(
    getSupportedExtensions(extraExtensions).map((extension) => extension.toLowerCase())
  );
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let closePromise: Promise<void> | undefined;

  const trigger = (filePath: string) => {
    if (stopped) return;
    if (!isTrackedSourcePath(filePath, trackedExtensions)) return;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      onChanged();
    }, debounceMs);
  };

  const watcher = chokidar.watch(rootPath, {
    ignored: (filePath) => {
      const pathParts = filePath.split(/[\\/]+/);
      return EXCLUDED_DIRECTORY_NAMES.some((directoryName) => pathParts.includes(directoryName));
    },
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
  });

  watcher
    .on('ready', () => {
      if (!stopped) onReady?.();
    })
    .on('add', trigger)
    .on('change', trigger)
    .on('unlink', trigger)
    .on('error', (err: unknown) => console.error('[file-watcher] error:', err));

  return () => {
    if (closePromise) return closePromise;
    stopped = true;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = undefined;
    try {
      closePromise = watcher.close();
    } catch (error) {
      closePromise = Promise.reject(error);
      void closePromise.catch(() => undefined);
    }
    return closePromise;
  };
}
