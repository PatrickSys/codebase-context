/**
 * Thrown when the LanceDB index is corrupted or has a schema mismatch.
 * This error signals that re-indexing is required for semantic search to work.
 */
export class IndexCorruptedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexCorruptedError';
  }
}

/** Missing opt-in runtime, distinct from damaged index data. */
export class OptionalDependencyError extends Error {
  constructor(packageName: string, versionRange: string) {
    super(
      `Semantic mode needs ${packageName}. In the environment where CBC is installed, run npm install "${packageName}@${versionRange}", then retry.`
    );
    this.name = 'OptionalDependencyError';
  }
}

/** Producer corruption is fatal to this build, never a skippable source read error. */
export class InvalidSourceChunkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSourceChunkError';
  }
}
