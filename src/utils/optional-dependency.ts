import { createRequire } from 'node:module';
import { OptionalDependencyError } from '../errors/index.js';

const resolve = createRequire(import.meta.url).resolve;

/** Check an opt-in dependency without loading its native runtime or model. */
export function assertOptionalDependency(packageName: string, versionRange: string): void {
  try {
    resolve(packageName);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND') {
      throw new OptionalDependencyError(packageName, versionRange);
    }
    throw error;
  }
}
