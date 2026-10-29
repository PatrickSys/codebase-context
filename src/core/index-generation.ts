import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { atomicWrite } from '../utils/atomic-write.js';
import {
  CODEBASE_CONTEXT_DIRNAME,
  INDEX_META_FILENAME,
  KEYWORD_INDEX_FILENAME,
  VECTOR_DB_DIRNAME,
  INTELLIGENCE_FILENAME,
  MANIFEST_FILENAME,
  INDEXING_STATS_FILENAME,
  RELATIONSHIPS_FILENAME,
  HEALTH_FILENAME,
  INDEX_FORMAT_VERSION,
  INDEX_META_VERSION,
  MEMORY_FILENAME
} from '../constants/codebase-context.js';
import { IndexCorruptedError } from '../errors/index.js';
import {
  IndexMetaSchema,
  readIndexMetaFromFile,
  validateIndexArtifacts,
  type IndexMeta
} from './index-meta.js';

export const MAX_INDEX_GENERATIONS = 3;
const GENERATIONS = '.generations';
const OwnerSchema = z.object({ pid: z.number().int().positive() });
const TicketSchema = OwnerSchema.extend({
  choosing: z.boolean(),
  ticket: z.number().int().nonnegative()
});
const PinSchema = OwnerSchema.extend({
  buildId: z.string().min(1),
  released: z.boolean().default(false)
});
type Snapshot = {
  kind: 'committed';
  root: string;
  realRoot: string;
  meta: IndexMeta;
  directory: string;
};
type UnavailableSnapshot = { kind: 'legacy' | 'unavailable'; root: string; directory: string };
type IndexBoundary = Snapshot | UnavailableSnapshot;
const snapshots = new AsyncLocalStorage<IndexBoundary | undefined>();
const pendingPinReleases = new Map<string, { root: string; buildId: string }>();
const writers = new AsyncLocalStorage<string>();
const rootPaths = new AsyncLocalStorage<{ root: string; realRoot: string }>();

async function withResolvedRoot<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const current = rootPaths.getStore();
  if (current && (current.root === root || current.realRoot === root)) return operation();
  return rootPaths.run({ root, realRoot: await fs.realpath(root) }, operation);
}

function rootKey(rootPath: string): string {
  const root = path.resolve(rootPath);
  const current = rootPaths.getStore();
  return current && (current.root === root || current.realRoot === root) ? current.realRoot : root;
}

export class IndexCapacityError extends Error {}

const GENERATION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type RecordedMode = 'keyword' | 'semantic';
export type IndexDiskState =
  | { kind: 'fresh' | 'incomplete-first-build' }
  | { kind: 'committed'; mode: RecordedMode }
  | { kind: 'legacy'; mode: RecordedMode | 'unknown' }
  | { kind: 'recoverable-unpublished'; generations: string[] }
  | { kind: 'unknown'; reason: string };
type GenerationEvidence = { kind: 'complete' | 'incomplete' } | { kind: 'unknown'; reason: string };
const DERIVED_FILES: readonly string[] = [
  KEYWORD_INDEX_FILENAME,
  VECTOR_DB_DIRNAME,
  INTELLIGENCE_FILENAME,
  MANIFEST_FILENAME,
  INDEXING_STATS_FILENAME,
  RELATIONSHIPS_FILENAME,
  HEALTH_FILENAME
];

function bindGenerationMeta(meta: IndexMeta): IndexMeta {
  const prefix = `${GENERATIONS}/${meta.buildId}/`;
  return IndexMetaSchema.parse({
    ...meta,
    artifacts: Object.fromEntries(
      Object.entries(meta.artifacts).map(([key, value]) => {
        const artifact = z.object({ path: z.string() }).passthrough().parse(value);
        return [key, { ...artifact, path: `${prefix}${artifact.path}` }];
      })
    )
  });
}

async function optionalJson(
  root: string,
  relative: string
): Promise<{ kind: 'missing' } | { kind: 'value'; value: unknown } | { kind: 'malformed' }> {
  let raw: string;
  try {
    raw = await fs.readFile(await confinedPath(root, relative), 'utf8');
  } catch (error) {
    if (isMissing(error)) return { kind: 'missing' };
    throw error;
  }
  try {
    return { kind: 'value', value: JSON.parse(raw) };
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: 'malformed' };
    throw error;
  }
}

/** Admission-held: no lock-taking public resolver or provider is initialized here. */
async function inspectGeneration(root: string, name: string): Promise<GenerationEvidence> {
  if (!GENERATION_ID.test(name))
    return { kind: 'unknown', reason: 'Unrecognized generation entry.' };
  const relative = `${GENERATIONS}/${name}`;
  try {
    const directory = await confinedPath(root, relative);
    if (!(await fs.stat(directory)).isDirectory())
      return { kind: 'unknown', reason: 'Generation is not a directory.' };
    await validateIndexArtifactTree(root, directory);
    const entries = await fs.readdir(directory);
    if (entries.some((entry) => ![...DERIVED_FILES, INDEX_META_FILENAME].includes(entry)))
      return { kind: 'unknown', reason: 'Generation contains unknown data.' };
    const local = await optionalJson(root, `${relative}/${INDEX_META_FILENAME}`);
    if (local.kind !== 'missing') {
      const parsed = local.kind === 'value' ? IndexMetaSchema.safeParse(local.value) : undefined;
      if (
        !parsed?.success ||
        parsed.data.buildId !== name ||
        parsed.data.metaVersion !== INDEX_META_VERSION ||
        parsed.data.formatVersion !== INDEX_FORMAT_VERSION
      )
        return { kind: 'unknown', reason: 'Generation completion metadata is untrusted.' };
      // Local completion metadata must name this directory's fixed artifact set.
      for (const filename of DERIVED_FILES) artifactRelative(parsed.data, filename);
      if (parsed.data.artifacts.keywordIndex.path !== KEYWORD_INDEX_FILENAME)
        return { kind: 'unknown', reason: 'Generation metadata is not local.' };
      for (const filename of DERIVED_FILES)
        await fs.access(await confinedPath(root, `${relative}/${filename}`));
      await validateIndexArtifacts(root, bindGenerationMeta(parsed.data));
      return { kind: 'complete' };
    }
    const writeOrder = [
      VECTOR_DB_DIRNAME,
      KEYWORD_INDEX_FILENAME,
      INTELLIGENCE_FILENAME,
      RELATIONSHIPS_FILENAME,
      HEALTH_FILENAME,
      MANIFEST_FILENAME,
      INDEXING_STATS_FILENAME
    ];
    if (writeOrder.slice(0, entries.length).some((filename) => !entries.includes(filename)))
      return { kind: 'unknown', reason: 'Artifacts do not form a writer-produced prefix.' };
    // A closed writer-produced prefix is recoverable as a first build only when
    // it contains no native payload and every completed JSON write is coherent.
    for (const filename of entries) {
      if (filename === VECTOR_DB_DIRNAME) {
        const native = await fs.readdir(await confinedPath(root, `${relative}/${filename}`));
        if (native.some((entry) => entry !== 'index-build.json'))
          return {
            kind: 'unknown',
            reason: 'Native vectors exist without trusted completion metadata.'
          };
        if (entries.length > 1 && !native.includes('index-build.json'))
          return { kind: 'unknown', reason: 'Artifacts precede their vector build marker.' };
        for (const entry of native) {
          const marker = await optionalJson(root, `${relative}/${filename}/${entry}`);
          const parsed =
            marker.kind === 'value'
              ? z
                  .object({
                    buildId: z.literal(name),
                    formatVersion: z.literal(INDEX_FORMAT_VERSION)
                  })
                  .safeParse(marker.value)
              : undefined;
          if (!parsed?.success)
            return { kind: 'unknown', reason: 'Incomplete vector marker is untrusted.' };
        }
      } else {
        const json = await optionalJson(root, `${relative}/${filename}`);
        const schema =
          filename === INDEXING_STATS_FILENAME
            ? z.object({
                indexedFiles: z.number().int().nonnegative(),
                totalChunks: z.number().int().nonnegative(),
                totalFiles: z.number().int().nonnegative(),
                generatedAt: z.string().datetime()
              })
            : z.object({
                header: z.object({
                  buildId: z.literal(name),
                  formatVersion: z.literal(INDEX_FORMAT_VERSION)
                })
              });
        if (json.kind !== 'value' || !schema.safeParse(json.value).success)
          return { kind: 'unknown', reason: 'Incomplete artifact is untrusted.' };
      }
    }
    return { kind: 'incomplete' };
  } catch (error) {
    if (error instanceof IndexCorruptedError || isMissing(error))
      return { kind: 'unknown', reason: 'Generation integrity cannot be established.' };
    throw error;
  }
}

async function inspectIndexDiskStateHeld(root: string): Promise<IndexDiskState> {
  const pointer = await optionalJson(root, INDEX_META_FILENAME);
  if (pointer.kind !== 'missing') {
    const parsed = pointer.kind === 'value' ? IndexMetaSchema.safeParse(pointer.value) : undefined;
    if (
      !parsed?.success ||
      parsed.data.metaVersion > INDEX_META_VERSION ||
      parsed.data.formatVersion > INDEX_FORMAT_VERSION
    )
      return { kind: 'unknown', reason: 'Root index metadata is malformed or unsupported.' };
    const meta = parsed.data;
    const mode = meta.artifacts.vectorDb.embeddingEnabled === false ? 'keyword' : 'semantic';
    if (
      meta.artifacts.keywordIndex.path === KEYWORD_INDEX_FILENAME ||
      meta.formatVersion < INDEX_FORMAT_VERSION
    )
      return { kind: 'legacy', mode };
    for (const filename of DERIVED_FILES)
      await confinedPath(root, artifactRelative(meta, filename));
    return { kind: 'committed', mode };
  }
  const context = await contextDirectory(root);
  const entries = await fs.readdir(context);
  if (
    entries.some(
      (entry) =>
        ![
          ...DERIVED_FILES,
          MEMORY_FILENAME,
          '.writers',
          '.publication',
          '.pins',
          GENERATIONS
        ].includes(entry)
    )
  )
    return { kind: 'unknown', reason: 'Index directory contains unrecognized data.' };
  if (entries.some((entry) => DERIVED_FILES.includes(entry)))
    return { kind: 'legacy', mode: 'unknown' };
  const directory = await confinedPath(root, GENERATIONS);
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (isMissing(error)) return { kind: 'fresh' };
    throw error;
  }
  const completed: string[] = [];
  for (const name of names) {
    const evidence = await inspectGeneration(root, name);
    if (evidence.kind === 'unknown') return { kind: 'unknown', reason: evidence.reason };
    if (evidence.kind === 'complete') completed.push(name);
  }
  if (completed.length) return { kind: 'recoverable-unpublished', generations: completed };
  return { kind: names.length ? 'incomplete-first-build' : 'fresh' };
}

export async function inspectIndexDiskState(rootPath: string): Promise<IndexDiskState> {
  const root = path.resolve(rootPath);
  return withResolvedRoot(root, () =>
    withLease(rootKey(root), '.publication', () => inspectIndexDiskStateHeld(rootKey(root)))
  );
}

/** Only these states authorize automatic first-build indexing. */
export function permitsFirstBuild(state: IndexDiskState): boolean {
  return state.kind === 'fresh' || state.kind === 'incomplete-first-build';
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM cannot establish that the owner is dead.
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

function contained(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/** Reject links at every artifact component, including a linked context directory. */
async function confinedPath(root: string, relative: string): Promise<string> {
  if (
    !relative ||
    relative.includes('\0') ||
    path.posix.isAbsolute(relative) ||
    path.win32.isAbsolute(relative)
  ) {
    throw new IndexCorruptedError('Invalid index artifact path. Rebuild required.');
  }
  const parts = relative.replace(/\\/g, '/').split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new IndexCorruptedError('Escaping index artifact path. Rebuild required.');
  }
  const current = rootPaths.getStore();
  const realRoot =
    current && (current.root === path.resolve(root) || current.realRoot === path.resolve(root))
      ? current.realRoot
      : await fs.realpath(root);
  let target = realRoot;
  for (const part of [CODEBASE_CONTEXT_DIRNAME, ...parts]) {
    target = path.join(target, part);
    try {
      if ((await fs.lstat(target)).isSymbolicLink())
        throw new IndexCorruptedError('Linked index artifacts are unsafe. Rebuild required.');
      if (!contained(realRoot, await fs.realpath(target)))
        throw new IndexCorruptedError('Index artifact escapes project.');
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return target;
}

async function contextDirectory(root: string): Promise<string> {
  // confinedPath checks the context component even when the lock directory is absent.
  const probe = await confinedPath(root, '.writers');
  const directory = path.dirname(probe);
  await fs.mkdir(directory, { recursive: true });
  return directory;
}

async function atomicJson(target: string, value: unknown): Promise<void> {
  await atomicWrite(target, JSON.stringify(value));
}

/**
 * Lamport's bakery lock uses unique, atomic ticket files rather than unlinking a
 * shared stale lock. Concurrent dead-owner recovery cannot remove a successor.
 * The lock covers baseline selection as well as staging and publication.
 * Algorithm: https://lamport.azurewebsites.net/pubs/bakery.pdf
 */
async function withLease<T>(
  rootPath: string,
  leaseDirectory: string,
  operation: () => Promise<T>
): Promise<T> {
  const root = path.resolve(rootPath);
  await contextDirectory(root);
  const directory = await confinedPath(root, leaseDirectory);
  await fs.mkdir(directory, { recursive: true });
  const id = `${process.pid}-${randomUUID()}.json`;
  const ownPath = path.join(directory, id);
  const owner = { pid: process.pid, choosing: true, ticket: 0 };
  const readTickets = async () => {
    const tickets: Array<{ id: string; owner: z.infer<typeof TicketSchema> }> = [];
    for (const entry of await fs.readdir(directory)) {
      if (!entry.endsWith('.json')) continue;
      const filename = await confinedPath(root, `${leaseDirectory}/${entry}`);
      let value: unknown;
      try {
        value = JSON.parse(await fs.readFile(filename, 'utf8'));
      } catch (error) {
        if (isMissing(error)) continue;
        throw error;
      }
      const ticket = TicketSchema.parse(value);
      if (!isAlive(ticket.pid) || (!ticket.choosing && ticket.ticket === 0)) {
        await fs.rm(filename, { force: true }).catch(() => undefined);
        continue;
      }
      tickets.push({ id: entry, owner: ticket });
    }
    return tickets;
  };
  try {
    await atomicJson(ownPath, owner);
    owner.ticket = 1 + Math.max(0, ...(await readTickets()).map((entry) => entry.owner.ticket));
    owner.choosing = false;
    await atomicJson(ownPath, owner);
    const deadline = Date.now() + 60_000;
    while (
      (await readTickets()).some(
        (entry) =>
          entry.id !== id &&
          (entry.owner.choosing ||
            entry.owner.ticket < owner.ticket ||
            (entry.owner.ticket === owner.ticket && entry.id < id))
      )
    ) {
      if (Date.now() >= deadline)
        throw new Error('Index writer is busy; retry after the current build.');
      await delay(25);
    }
    return await operation();
  } finally {
    // Zero is a released ticket even when file deletion fails. A failed cleanup
    // must never turn a successful metadata commit into an indexing failure.
    try {
      await atomicJson(ownPath, { ...owner, choosing: false, ticket: 0 });
    } catch (error) {
      console.warn('Index lease release deferred:', error);
    }
    await fs
      .rm(ownPath, { force: true })
      .catch((error: unknown) => console.warn('Index lease cleanup deferred:', error));
    // Keep the empty directory: deleting it races the next ticket creator.
  }
}

export async function withIndexWriter<T>(
  rootPath: string,
  operation: () => Promise<T>
): Promise<T> {
  const root = path.resolve(rootPath);
  return withResolvedRoot(root, () =>
    withLease(rootKey(root), '.writers', () =>
      writers.run(rootKey(root), () => snapshots.run(undefined, operation))
    )
  );
}

function currentIndexBoundary(rootPath: string): IndexBoundary | undefined {
  const snapshot = snapshots.getStore();
  return snapshot?.root === rootKey(rootPath) ? snapshot : undefined;
}

export function currentIndexSnapshot(rootPath: string): Snapshot | undefined {
  const boundary = currentIndexBoundary(rootPath);
  return boundary?.kind === 'committed' ? boundary : undefined;
}

export function indexUnavailableForOperation(rootPath: string): boolean {
  const boundary = currentIndexBoundary(rootPath);
  return boundary !== undefined && boundary.kind !== 'committed';
}

async function readPublishedMeta(root: string): Promise<IndexMeta> {
  const filename = await confinedPath(root, INDEX_META_FILENAME);
  await fs.access(filename);
  return readIndexMetaFromFile(filename);
}

function artifactRelative(meta: IndexMeta, filename: string): string {
  const entries: Record<string, { path: string } | undefined> = {
    [KEYWORD_INDEX_FILENAME]: meta.artifacts.keywordIndex,
    [VECTOR_DB_DIRNAME]: meta.artifacts.vectorDb,
    [INTELLIGENCE_FILENAME]: meta.artifacts.intelligence,
    [MANIFEST_FILENAME]: meta.artifacts.manifest,
    [INDEXING_STATS_FILENAME]: meta.artifacts.indexingStats,
    [RELATIONSHIPS_FILENAME]: meta.artifacts.relationships,
    [HEALTH_FILENAME]: meta.artifacts.health
  };
  const generationPrefix = `${GENERATIONS}/${meta.buildId}/`;
  const prefix =
    meta.artifacts.keywordIndex.path === `${generationPrefix}${KEYWORD_INDEX_FILENAME}`
      ? generationPrefix
      : '';
  // A legacy build uses fixed names throughout. A generation uses exactly one
  // directory throughout, even when a caller asks for just one optional artifact.
  for (const [name, artifact] of Object.entries(entries)) {
    if (artifact && artifact.path !== `${prefix}${name}`)
      throw new IndexCorruptedError(
        `Index artifact ${name} path belongs to a different generation.`
      );
  }
  const relative = entries[filename]?.path ?? `${prefix}${filename}`;
  if (prefix && relative !== `${prefix}${filename}`)
    throw new IndexCorruptedError(
      `Index artifact ${filename} path belongs to a different generation.`
    );
  return relative;
}

export async function resolveIndexArtifact(
  root: string,
  filename: string,
  meta?: IndexMeta
): Promise<string> {
  const boundary = currentIndexBoundary(root);
  if (boundary && boundary.kind !== 'committed') {
    try {
      return await confinedPath(root, filename);
    } catch (error) {
      if (isMissing(error)) return path.join(root, CODEBASE_CONTEXT_DIRNAME, filename);
      throw error;
    }
  }
  if (
    boundary?.kind === 'committed' &&
    meta &&
    (meta.buildId !== boundary.meta.buildId ||
      meta.artifacts.keywordIndex.path !== boundary.meta.artifacts.keywordIndex.path)
  )
    throw new IndexCorruptedError('Artifact metadata differs from the pinned generation.');
  let selected = boundary?.kind === 'committed' ? boundary.meta : meta;
  if (!selected) {
    try {
      selected = await readPublishedMeta(root);
    } catch (error) {
      if (isMissing(error)) return path.join(root, CODEBASE_CONTEXT_DIRNAME, filename);
      throw error;
    }
  }
  try {
    return await confinedPath(root, artifactRelative(selected, filename));
  } catch (error) {
    if (error instanceof IndexCorruptedError)
      throw new IndexCorruptedError(`${filename} artifact path: ${error.message}`);
    throw error;
  }
}

/** Older metadata-free artifacts and an absent first build are snapshots too. */
export async function withAvailableIndexSnapshot<T>(
  root: string,
  operation: () => Promise<T>
): Promise<T> {
  if (currentIndexBoundary(root)) return operation();
  try {
    await fs.access(path.join(root, CODEBASE_CONTEXT_DIRNAME, INDEX_META_FILENAME));
  } catch (error) {
    if (isMissing(error)) return withLegacyOrEmptySnapshot(root, operation);
    throw error;
  }
  let started = false;
  try {
    return await withIndexSnapshot(root, () => {
      started = true;
      return operation();
    });
  } catch (error) {
    // Preserve the owning tool's auto-heal/error path without letting nested
    // readers switch to a publication that arrived halfway through this call.
    if (!started && error instanceof IndexCorruptedError)
      return withLegacyOrEmptySnapshot(root, operation);
    throw error;
  }
}

async function withLegacyOrEmptySnapshot<T>(
  rootPath: string,
  operation: () => Promise<T>
): Promise<T> {
  const root = path.resolve(rootPath);
  try {
    await fs.access(path.join(root, CODEBASE_CONTEXT_DIRNAME, KEYWORD_INDEX_FILENAME));
  } catch (error) {
    if (!isMissing(error)) throw error;
    return snapshots.run(
      {
        kind: 'unavailable',
        root: rootKey(root),
        directory: path.join(root, CODEBASE_CONTEXT_DIRNAME)
      },
      operation
    );
  }
  return withResolvedRoot(root, () => pinSnapshot(rootKey(root), operation, true));
}

/** Pin before validation/loading; nested readers cannot change the selected build. */
export async function withIndexSnapshot<T>(
  rootPath: string,
  operation: () => Promise<T>
): Promise<T> {
  const boundary = currentIndexBoundary(rootPath);
  if (boundary?.kind === 'committed') return operation();
  if (boundary)
    throw new IndexCorruptedError(
      'No committed index was available at the start of this operation. Rebuild required.'
    );
  const root = path.resolve(rootPath);
  return withResolvedRoot(root, () => pinSnapshot(rootKey(root), operation));
}

async function releasePin(root: string, pinPath: string, buildId: string): Promise<void> {
  pendingPinReleases.set(pinPath, { root, buildId });
  await atomicJson(pinPath, { pid: process.pid, buildId, released: true }).catch((error: unknown) =>
    console.warn('Index pin release deferred:', error)
  );
  try {
    await fs.rm(pinPath, { force: true });
    pendingPinReleases.delete(pinPath);
  } catch (error) {
    console.warn('Index pin cleanup deferred:', error);
  }
}

async function pinSnapshot<T>(
  root: string,
  operation: () => Promise<T>,
  allowLegacy = false
): Promise<T> {
  let pinPath = '';
  let pinBuildId = 'legacy-unversioned';
  let snapshot: IndexBoundary;
  try {
    snapshot = await withLease(root, '.publication', async (): Promise<IndexBoundary> => {
      let meta: IndexMeta | null;
      try {
        meta = await readPublishedMeta(root);
      } catch (error) {
        if (!allowLegacy || (!isMissing(error) && !(error instanceof IndexCorruptedError)))
          throw error;
        meta = null;
      }
      let selected: IndexBoundary;
      if (meta) {
        const indexPath = await resolveIndexArtifact(root, KEYWORD_INDEX_FILENAME, meta);
        for (const name of [
          VECTOR_DB_DIRNAME,
          INTELLIGENCE_FILENAME,
          MANIFEST_FILENAME,
          INDEXING_STATS_FILENAME,
          RELATIONSHIPS_FILENAME,
          HEALTH_FILENAME
        ])
          await resolveIndexArtifact(root, name, meta);
        const resolved = rootPaths.getStore();
        if (!resolved) throw new Error('Snapshot root resolution is missing.');
        selected = {
          kind: 'committed',
          root,
          realRoot: resolved.realRoot,
          meta,
          directory: path.dirname(indexPath)
        };
        pinBuildId = meta.buildId;
      } else {
        selected = {
          kind: 'legacy',
          root,
          directory: path.dirname(await confinedPath(root, KEYWORD_INDEX_FILENAME))
        };
      }
      const pinDirectory = await confinedPath(root, '.pins');
      await fs.mkdir(pinDirectory, { recursive: true });
      pinPath = path.join(pinDirectory, `${process.pid}-${randomUUID()}.json`);
      await atomicJson(pinPath, { pid: process.pid, buildId: pinBuildId });
      return selected;
    });
  } catch (error) {
    if (pinPath) await releasePin(root, pinPath, pinBuildId);
    throw error;
  }
  try {
    return await snapshots.run(snapshot, operation);
  } finally {
    await releasePin(root, pinPath, pinBuildId);
  }
}

async function livePins(root: string): Promise<Set<string>> {
  // Retry only releases this process knows completed; active operations remain pinned.
  for (const [filename, release] of pendingPinReleases) {
    if (release.root === rootKey(root)) await releasePin(root, filename, release.buildId);
  }
  const directory = await confinedPath(root, '.pins');
  const builds = new Set<string>();
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (isMissing(error)) return builds;
    throw error;
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const filename = await confinedPath(root, `.pins/${name}`);
    let pin: z.infer<typeof PinSchema>;
    try {
      pin = PinSchema.parse(JSON.parse(await fs.readFile(filename, 'utf8')));
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    if (!pin.released && isAlive(pin.pid)) builds.add(pin.buildId);
    else await fs.rm(filename, { force: true }).catch(() => undefined);
  }
  return builds;
}

/** Called only while holding the writer lease; unknown pins fail closed. */
async function collect(root: string, reserve: number): Promise<void> {
  const directory = await confinedPath(root, GENERATIONS);
  await fs.mkdir(directory, { recursive: true });
  let active: string | undefined;
  let activeGeneration = false;
  try {
    const raw: unknown = JSON.parse(
      await fs.readFile(await confinedPath(root, INDEX_META_FILENAME), 'utf8')
    );
    const parsed = IndexMetaSchema.safeParse(raw);
    if (
      parsed.success &&
      parsed.data.metaVersion === INDEX_META_VERSION &&
      parsed.data.formatVersion === INDEX_FORMAT_VERSION
    ) {
      for (const filename of DERIVED_FILES) artifactRelative(parsed.data, filename);
      active = parsed.data.buildId;
      activeGeneration = parsed.data.artifacts.keywordIndex.path.startsWith(`${GENERATIONS}/`);
    }
  } catch (error) {
    if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
  }
  const pinned = await livePins(root);
  const names = await fs.readdir(directory);
  const legacyIndex = await confinedPath(root, KEYWORD_INDEX_FILENAME);
  let hasLegacy = false;
  try {
    await fs.access(legacyIndex);
    hasLegacy = true;
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  // Legacy snapshots use fixed files and never mutate them after migration. Keep
  // them while a legacy reader is pinned; they count toward the same ceiling.
  if (
    hasLegacy &&
    activeGeneration &&
    !Array.from(pinned).some((build) => !names.includes(build))
  ) {
    for (const filename of [
      KEYWORD_INDEX_FILENAME,
      VECTOR_DB_DIRNAME,
      MANIFEST_FILENAME,
      INTELLIGENCE_FILENAME,
      INDEXING_STATS_FILENAME,
      RELATIONSHIPS_FILENAME,
      HEALTH_FILENAME
    ]) {
      await fs.rm(await confinedPath(root, filename), { recursive: true, force: true });
    }
    hasLegacy = false;
  }
  let count = names.length + Number(hasLegacy);
  for (const name of names) {
    if (count + reserve <= MAX_INDEX_GENERATIONS) break;
    if (name === active || pinned.has(name)) continue;
    // Unknown entries are preserved and consume capacity, never guessed disposable.
    const evidence = await inspectGeneration(root, name);
    if (evidence.kind === 'unknown' || (!activeGeneration && evidence.kind !== 'incomplete'))
      continue;
    const target = await confinedPath(root, `${GENERATIONS}/${name}`);
    await fs.rm(target, { recursive: true, force: true });
    count--;
  }
  if (count + reserve > MAX_INDEX_GENERATIONS)
    throw new IndexCapacityError(
      activeGeneration
        ? 'Index refresh deferred: live readers or unknown data occupy the three-generation capacity. Retry after readers finish; preserve unknown data.'
        : 'Index recovery needs space: preserved generations occupy the three-generation capacity. Back up and verify an operator-selected generation, relocate it outside .codebase-context/.generations, then retry an explicit --embeddings or --no-embeddings reindex. No completed or unknown generation was selected or deleted.'
    );
}

/** Native storage can read nested files, so validate the whole artifact tree. */
export async function validateIndexArtifactTree(root: string, directory: string): Promise<void> {
  const current = rootPaths.getStore();
  const realRoot =
    current && (current.root === path.resolve(root) || current.realRoot === path.resolve(root))
      ? current.realRoot
      : await fs.realpath(root);
  const context = path.join(realRoot, CODEBASE_CONTEXT_DIRNAME);
  const inspect = async (target: string): Promise<void> => {
    await confinedPath(root, path.relative(context, target));
    for (const entry of await fs.readdir(target, { withFileTypes: true })) {
      const filename = path.join(target, entry.name);
      await confinedPath(root, path.relative(context, filename));
      if (entry.isDirectory()) await inspect(filename);
    }
  };
  await inspect(directory);
}

/** Clone a closed immutable vector baseline without carrying filesystem links. */
export async function copyIndexVectors(
  root: string,
  baseline: string,
  destination: string
): Promise<void> {
  await validateIndexArtifactTree(root, baseline);
  await fs.cp(baseline, destination, {
    recursive: true,
    dereference: false,
    force: false,
    errorOnExist: true
  });
}

export async function prepareIndexGeneration(root: string, buildId: string): Promise<string> {
  if (writers.getStore() !== rootKey(root))
    throw new Error('Generation preparation requires the writer lease.');
  return withLease(root, '.publication', async () => {
    await collect(root, 1);
    const directory = await confinedPath(root, `${GENERATIONS}/${buildId}`);
    await fs.mkdir(directory);
    return directory;
  });
}

/** Atomic metadata replacement is the sole commit point. Cleanup never rolls it back. */
export async function publishIndexGeneration(root: string, meta: IndexMeta): Promise<void> {
  if (writers.getStore() !== rootKey(root))
    throw new Error('Index publication requires the writer lease.');
  const published = bindGenerationMeta(meta);
  await withLease(root, '.publication', async () => {
    await validateIndexArtifacts(root, published);
    await atomicJson(await confinedPath(root, INDEX_META_FILENAME), published);
    try {
      await collect(root, 0);
    } catch (error) {
      console.warn('Index committed; generation cleanup deferred:', error);
    }
  });
}
