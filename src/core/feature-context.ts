import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ignore from 'ignore';
import { load as parseYaml } from 'js-yaml';
import { z } from 'zod';
import { isPathWithin } from '../utils/project-discovery.js';
import { MAX_TREE_SITTER_PARSE_BYTES } from '../utils/tree-sitter.js';

const MAX_REPLY_TOKENS = 900;
const MAX_DIAGNOSTICS_IN_REPLY = 6;
const MAX_DIAGNOSTIC_MESSAGE_CHARS = 160;
const MAX_INDEX_ATTACHMENTS = 5000;
const MAX_INDEX_DIAGNOSTICS = 1000;

const RelativePathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !value.includes('\\') && !value.includes('\0'), {
    message: 'Path must use normalized POSIX separators'
  })
  .refine((value) => !value.includes(':'), { message: 'Colon characters are not allowed in paths' })
  .refine((value) => !path.posix.isAbsolute(value), { message: 'Path must be relative' })
  .refine((value) => !/^[a-zA-Z]:/.test(value), {
    message: 'Drive-qualified paths are not allowed'
  })
  .refine(
    (value) => value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    {
      message: 'Path must not contain empty, current, or parent segments'
    }
  );

export const FeatureTargetSchema = z
  .object({
    path: RelativePathSchema,
    symbol: z.string().min(1).max(160).optional()
  })
  .strict();

const DeclaredTestSchema = z
  .object({
    path: RelativePathSchema,
    name: z.string().min(1).max(200)
  })
  .strict();

export const FeatureContextManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    attachments: z
      .array(
        z
          .object({
            requirementId: z.string().min(1).max(120),
            source: z
              .object({ path: RelativePathSchema, locator: z.string().min(1).max(240) })
              .strict(),
            appliesTo: z.array(FeatureTargetSchema).min(1).max(64),
            declaredTests: z.array(DeclaredTestSchema).max(64),
            evidenceReceipts: z.array(RelativePathSchema).max(32)
          })
          .strict()
      )
      .min(1)
      .max(100)
  })
  .strict();

const CapturedRunReceiptSchemaBase = z
  .object({
    schemaVersion: z.literal(1),
    runner: z.string().min(1).max(80),
    runId: z.string().min(1).max(120),
    test: DeclaredTestSchema,
    outcome: z.enum(['passed', 'failed', 'skipped']),
    code: z
      .object({
        commit: z.string().regex(/^[a-fA-F0-9]{40,64}$/),
        clean: z.literal(true)
      })
      .strict(),
    source: z
      .object({
        path: RelativePathSchema,
        sha256: z.string().regex(/^[a-fA-F0-9]{64}$/)
      })
      .strict(),
    environment: z
      .object({
        node: z.string().min(1).max(80),
        os: z.string().min(1).max(80),
        browser: z.string().min(1).max(80).optional()
      })
      .strict(),
    report: z
      .object({
        path: RelativePathSchema,
        sha256: z.string().regex(/^[a-fA-F0-9]{64}$/)
      })
      .strict()
  })
  .strict();

export const CapturedRunReceiptSchema = CapturedRunReceiptSchemaBase;

export type FeatureTarget = z.infer<typeof FeatureTargetSchema>;
export type DeclaredTest = z.infer<typeof DeclaredTestSchema>;
export type FeatureContextManifest = z.infer<typeof FeatureContextManifestSchema>;
export type FeatureAttachment = FeatureContextManifest['attachments'][number];
export type CapturedRunReceipt = z.infer<typeof CapturedRunReceiptSchema>;

export const ContextDiagnosticCodeSchema = z.enum([
  'invalid-manifest',
  'manifest-not-found',
  'ignored-manifest',
  'missing-source',
  'invalid-source-locator',
  'unsupported-source-locator',
  'missing-target',
  'ambiguous-target',
  'unsupported-symbol',
  'stale-manifest',
  'stale-source',
  'stale-target',
  'stale-test',
  'stale-evidence',
  'invalid-receipt',
  'missing-receipt',
  'missing-report',
  'run-not-passed',
  'dirty-code',
  'git-unavailable',
  'index-refresh-required',
  'path-outside-root',
  'diagnostics-truncated',
  'matches-omitted'
]);

export const ContextDiagnosticSchema = z
  .object({
    code: ContextDiagnosticCodeSchema,
    path: RelativePathSchema.optional(),
    message: z.string().min(1).max(MAX_DIAGNOSTIC_MESSAGE_CHARS)
  })
  .strict();

const SymbolIdentitySchema = z
  .object({
    path: RelativePathSchema,
    name: z.string().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive()
  })
  .strict()
  .refine((identity) => identity.endLine >= identity.startLine);

const CompiledTargetSchema = z
  .object({
    target: FeatureTargetSchema,
    status: z.enum(['resolved', 'missing', 'ambiguous', 'unsupported']),
    identity: SymbolIdentitySchema.optional(),
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional()
  })
  .strict();

const CompiledTestSchema = z
  .object({
    test: DeclaredTestSchema,
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional()
  })
  .strict();

const CompiledReceiptSchema = z
  .object({
    path: RelativePathSchema,
    sha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
    receipt: CapturedRunReceiptSchema.optional(),
    reportSha256: z
      .string()
      .regex(/^[a-fA-F0-9]{64}$/)
      .optional(),
    diagnostics: z.array(ContextDiagnosticSchema).max(32)
  })
  .strict();

const CompiledAttachmentSchema = z
  .object({
    manifestPath: RelativePathSchema,
    manifestSha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
    requirementId: z.string().min(1).max(120),
    source: z
      .object({
        path: RelativePathSchema,
        locator: z.string().min(1).max(240),
        status: z.enum(['resolved', 'invalid', 'unsupported', 'missing']).optional(),
        sha256: z
          .string()
          .regex(/^[a-fA-F0-9]{64}$/)
          .optional()
      })
      .strict(),
    appliesTo: z.array(CompiledTargetSchema).max(64),
    declaredTests: z.array(CompiledTestSchema).max(64),
    recordedEvidence: z.array(CompiledReceiptSchema).max(32),
    diagnostics: z.array(ContextDiagnosticSchema).max(500)
  })
  .strict();

export const FeatureContextIndexSchema = z
  .object({
    schemaVersion: z.literal(1),
    code: z
      .object({
        commit: z
          .string()
          .regex(/^[a-fA-F0-9]{40,64}$/)
          .nullable(),
        clean: z.boolean()
      })
      .strict(),
    attachments: z.array(CompiledAttachmentSchema).max(MAX_INDEX_ATTACHMENTS),
    diagnostics: z.array(ContextDiagnosticSchema).max(MAX_INDEX_DIAGNOSTICS)
  })
  .strict();

export type ContextDiagnosticCode = z.infer<typeof ContextDiagnosticCodeSchema>;
export type ContextDiagnostic = z.infer<typeof ContextDiagnosticSchema>;
export type IndexedSymbolRef = z.infer<typeof SymbolIdentitySchema>;
export type FeatureContextIndex = z.infer<typeof FeatureContextIndexSchema>;

const ReplyTargetSchema = z
  .object({
    target: FeatureTargetSchema,
    status: z.enum(['resolved', 'missing', 'ambiguous', 'unsupported']),
    identity: SymbolIdentitySchema.optional(),
    current: z.boolean()
  })
  .strict();

const ReplyEvidenceSchema = z
  .object({
    receiptPath: RelativePathSchema,
    runId: z.string().min(1).max(120).optional(),
    outcome: z.enum(['passed', 'failed', 'skipped']).optional(),
    fresh: z.boolean(),
    report: z
      .object({ path: RelativePathSchema, sha256: z.string().regex(/^[a-fA-F0-9]{64}$/) })
      .strict()
      .optional(),
    diagnostics: z.array(ContextDiagnosticSchema).max(32)
  })
  .strict();

const ReplyAttachmentSchema = z
  .object({
    requirementId: z.string().min(1).max(120),
    manifestPath: RelativePathSchema,
    source: z
      .object({
        path: RelativePathSchema,
        locator: z.string().min(1).max(240),
        status: z.enum(['resolved', 'invalid', 'unsupported', 'missing']),
        sha256: z
          .string()
          .regex(/^[a-fA-F0-9]{64}$/)
          .optional(),
        current: z.boolean()
      })
      .strict(),
    appliesTo: z.array(ReplyTargetSchema).max(64),
    declaredTests: z
      .array(z.object({ test: DeclaredTestSchema, current: z.boolean() }).strict())
      .max(64),
    recordedEvidence: z.array(ReplyEvidenceSchema).max(32),
    diagnostics: z.array(ContextDiagnosticSchema).max(500),
    omitted: z
      .object({
        appliesTo: z.number().int().nonnegative(),
        declaredTests: z.number().int().nonnegative(),
        recordedEvidence: z.number().int().nonnegative()
      })
      .strict()
      .optional()
  })
  .strict();

export const FeatureContextReplySchema = z
  .object({
    schemaVersion: z.literal(1),
    target: FeatureTargetSchema,
    matches: z.array(ReplyAttachmentSchema).max(100),
    counts: z
      .object({
        matches: z.number().int().nonnegative(),
        resolved: z.number().int().nonnegative(),
        diagnostics: z.number().int().nonnegative(),
        omitted: z.number().int().nonnegative(),
        omittedDiagnostics: z.number().int().nonnegative()
      })
      .strict(),
    truncated: z.boolean(),
    diagnostics: z.array(ContextDiagnosticSchema).max(MAX_DIAGNOSTICS_IN_REPLY + 2)
  })
  .strict();

export type FeatureContextReply = z.infer<typeof FeatureContextReplySchema>;

export interface CompileFeatureContextsInput {
  rootPath: string;
  manifestFiles: readonly { path: string; text: string }[];
  receiptFiles: readonly { path: string; text: string }[];
  indexedSymbols: readonly IndexedSymbolRef[];
  codeCommit: string | null;
  codeIsClean: boolean;
  ignoredPaths: readonly string[];
  /** Symbol-target files whose complete declaration set could not be parsed safely. */
  incompleteSymbolPaths?: readonly string[];
  /** Names with multiple distinct declaration occurrences, even when their lines match. */
  ambiguousSymbolKeys?: readonly { path: string; name: string }[];
  /** Same-name local bindings outside the supported declaration set. */
  unresolvedSymbolBindings?: readonly { path: string; name: string }[];
  /** Byte digests of symbol files used to extract the candidate set. */
  symbolSourceDigests?: readonly { path: string; sha256: string }[];
}

export interface QueryFeatureContextInput {
  rootPath: string;
  index: FeatureContextIndex;
  target: FeatureTarget;
  currentGit: { commit: string | null; isClean: boolean };
  tokenLimit?: number;
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validateSourceLocator(
  source: FeatureAttachment['source'],
  requirementId: string,
  bytes: Buffer
): 'resolved' | 'invalid' | 'unsupported' {
  const locator = /^([A-Za-z_][\w-]*)\[([^\[\]]+)\]$/.exec(source.locator);
  if (!locator || !/\.(?:yaml|yml|json)$/i.test(source.path)) return 'unsupported';
  const [, collection, id] = locator;
  if (id !== requirementId || !collection) return 'invalid';
  try {
    const text = bytes.toString('utf8');
    if (/\.json$/i.test(source.path)) JSON.parse(text) as unknown;
    const parsed = parseYaml(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'invalid';
    const entries: unknown = (parsed as Record<string, unknown>)[collection];
    if (!Array.isArray(entries)) return 'invalid';
    return entries.filter(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        !Array.isArray(entry) &&
        (entry as Record<string, unknown>).id === id
    ).length === 1
      ? 'resolved'
      : 'invalid';
  } catch {
    return 'invalid';
  }
}

function isWithin(rootPath: string, candidatePath: string): boolean {
  return isPathWithin(rootPath, candidatePath);
}

function diagnostic(
  code: ContextDiagnosticCode,
  message: string,
  relativePath?: string
): ContextDiagnostic {
  const safeMessage =
    message.length <= MAX_DIAGNOSTIC_MESSAGE_CHARS
      ? message
      : `${message.slice(0, MAX_DIAGNOSTIC_MESSAGE_CHARS - 3)}...`;
  const safePath = relativePath ? normalizeContextPath(relativePath) : undefined;
  return { code, message: safeMessage, ...(safePath ? { path: safePath } : {}) };
}

function targetStatusDiagnostic(
  target: FeatureTarget,
  status: 'resolved' | 'missing' | 'ambiguous' | 'unsupported'
): ContextDiagnostic | undefined {
  if (status === 'unsupported' && target.symbol)
    return diagnostic(
      'unsupported-symbol',
      `No unique supported source declaration could be established for ${target.symbol}`,
      target.path
    );
  if (status === 'ambiguous')
    return diagnostic(
      'ambiguous-target',
      `Multiple source ranges match ${target.symbol ?? target.path}`,
      target.path
    );
  if (status === 'missing')
    return diagnostic('missing-target', `Target file is missing: ${target.path}`, target.path);
  return undefined;
}

function normalizeContextPath(value: string): string | undefined {
  const parsed = RelativePathSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

type ContainedFileResolution =
  | { status: 'found'; absolutePath: string; bytes: Buffer }
  | { status: 'digested'; absolutePath: string; sha256: string }
  | { status: 'missing' | 'outside-root' | 'too-large' };

async function digestFile(absolutePath: string, maxBytes?: number): Promise<string | undefined> {
  const hash = createHash('sha256');
  const stream = createReadStream(absolutePath);
  let totalBytes = 0;
  try {
    for await (const chunk of stream) {
      const bytes = chunk as Buffer;
      totalBytes += bytes.byteLength;
      if (maxBytes !== undefined && totalBytes > maxBytes) {
        stream.destroy();
        return undefined;
      }
      hash.update(bytes);
    }
  } finally {
    stream.destroy();
  }
  return hash.digest('hex');
}

async function readBoundedFile(absolutePath: string, maxBytes: number): Promise<Buffer | null> {
  const handle = await fs.open(absolutePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) return null;

    const chunkSize = Math.min(64 * 1024, maxBytes + 1);
    const chunk = Buffer.allocUnsafe(chunkSize);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    while (totalBytes <= maxBytes) {
      const requested = Math.min(chunkSize, maxBytes + 1 - totalBytes);
      const { bytesRead } = await handle.read(chunk, 0, requested, totalBytes);
      if (bytesRead === 0) break;
      totalBytes += bytesRead;
      if (totalBytes > maxBytes) return null;
      chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, totalBytes);
  } finally {
    await handle.close();
  }
}

async function resolveContainedFile(
  rootRealPath: string,
  relativePath: string,
  options?: { maxBytes?: number; digestOnly?: boolean }
): Promise<ContainedFileResolution> {
  const normalized = normalizeContextPath(relativePath);
  if (!normalized) return { status: 'outside-root' };
  try {
    const lexicalPath = path.resolve(rootRealPath, ...normalized.split('/'));
    if (!isWithin(rootRealPath, lexicalPath)) return { status: 'outside-root' };
    let realPath: string;
    try {
      realPath = await fs.realpath(lexicalPath);
    } catch {
      return { status: 'missing' };
    }
    if (!isWithin(rootRealPath, realPath)) return { status: 'outside-root' };
    const stat = await fs.stat(realPath);
    if (!stat.isFile()) return { status: 'missing' };
    const maxBytes = options?.maxBytes;
    if (maxBytes !== undefined && stat.size > maxBytes) return { status: 'too-large' };
    if (options?.digestOnly) {
      const digest = await digestFile(realPath, maxBytes);
      if (!digest) return { status: maxBytes === undefined ? 'missing' : 'too-large' };
      return { status: 'digested', absolutePath: realPath, sha256: digest };
    }
    if (maxBytes !== undefined) {
      const bytes = await readBoundedFile(realPath, maxBytes);
      return bytes ? { status: 'found', absolutePath: realPath, bytes } : { status: 'too-large' };
    }
    return { status: 'found', absolutePath: realPath, bytes: await fs.readFile(realPath) };
  } catch {
    return { status: 'missing' };
  }
}

export type FeatureContextFileReadResult =
  | { status: 'found'; path: string; absolutePath: string; text: string; sha256: string }
  | { status: 'missing' | 'outside-root' | 'too-large' };

export async function readContainedFeatureContextFile(
  rootPath: string,
  relativePath: string,
  maxBytes?: number
): Promise<FeatureContextFileReadResult> {
  let rootRealPath: string;
  try {
    rootRealPath = await fs.realpath(rootPath);
  } catch {
    return { status: 'missing' };
  }
  const resolved = await resolveContainedFile(rootRealPath, relativePath, { maxBytes });
  if (resolved.status === 'digested') return { status: 'missing' };
  if (resolved.status !== 'found') return resolved;
  const normalized = normalizeContextPath(relativePath);
  if (!normalized) return { status: 'outside-root' };
  return {
    status: 'found',
    path: normalized,
    absolutePath: resolved.absolutePath,
    text: resolved.bytes.toString('utf8'),
    sha256: sha256(resolved.bytes)
  };
}

function isIgnored(relativePath: string, ignoredPaths: readonly string[]): boolean {
  const matcher = ignore.default().add([...ignoredPaths]);
  return matcher.ignores(relativePath);
}

function symbolKey(identity: IndexedSymbolRef): string {
  return `${identity.path}\0${identity.name}\0${identity.startLine}\0${identity.endLine}`;
}

function resolveDeclaredTarget(
  target: FeatureTarget,
  indexedSymbols: readonly IndexedSymbolRef[],
  pathExists: boolean,
  candidatesComplete: boolean,
  hasDuplicateOccurrence: boolean,
  hasUnresolvedBinding: boolean
): z.infer<typeof CompiledTargetSchema> {
  if (!target.symbol) {
    return {
      target,
      status: pathExists ? 'resolved' : 'missing'
    };
  }
  if (!pathExists) return { target, status: 'missing' };
  const matches = indexedSymbols.filter(
    (symbol) => symbol.path === target.path && symbol.name === target.symbol
  );
  const unique = new Map(matches.map((item) => [symbolKey(item), item]));
  const identities = [...unique.values()];
  if (hasDuplicateOccurrence || (candidatesComplete && identities.length > 1)) {
    return { target, status: 'ambiguous' };
  }
  if (identities.length === 1) {
    return {
      target,
      status: candidatesComplete && !hasUnresolvedBinding ? 'resolved' : 'unsupported',
      identity: identities[0]
    };
  }
  return { target, status: 'unsupported' };
}

function equalTest(left: DeclaredTest, right: DeclaredTest): boolean {
  return left.path === right.path && left.name === right.name;
}

export function parseFeatureContextManifest(
  pathValue: string,
  text: string
): { manifest?: FeatureContextManifest; diagnostics: ContextDiagnostic[] } {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          'invalid-manifest',
          error instanceof Error ? error.message : 'Invalid manifest JSON',
          normalizeContextPath(pathValue)
        )
      ]
    };
  }
  const parsed = FeatureContextManifestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      diagnostics: [
        diagnostic('invalid-manifest', parsed.error.message, normalizeContextPath(pathValue))
      ]
    };
  }
  return { manifest: parsed.data, diagnostics: [] };
}

export async function compileFeatureContexts(
  input: CompileFeatureContextsInput
): Promise<FeatureContextIndex> {
  const rootRealPath = await fs.realpath(input.rootPath);
  const indexDiagnostics: ContextDiagnostic[] = [];
  const attachments: FeatureContextIndex['attachments'] = [];
  let omittedAttachments = 0;
  const receiptTextByPath = new Map(input.receiptFiles.map((entry) => [entry.path, entry.text]));
  const deduplicatedSymbols = new Map<string, IndexedSymbolRef>();
  for (const item of input.indexedSymbols) {
    const normalized = normalizeContextPath(item.path);
    if (!normalized || item.startLine < 1 || item.endLine < item.startLine) continue;
    const identity = { ...item, path: normalized };
    deduplicatedSymbols.set(symbolKey(identity), identity);
  }
  const symbols = [...deduplicatedSymbols.values()];
  const incompleteSymbolPaths = new Set(input.incompleteSymbolPaths ?? []);
  const ambiguousSymbolKeys = new Set(
    (input.ambiguousSymbolKeys ?? []).map((item) => `${item.path}\0${item.name}`)
  );
  const unresolvedSymbolBindings = new Set(
    (input.unresolvedSymbolBindings ?? []).map((item) => `${item.path}\0${item.name}`)
  );
  const symbolSourceDigests = new Map(
    (input.symbolSourceDigests ?? []).map((item) => [item.path, item.sha256])
  );

  for (const file of input.manifestFiles) {
    const manifestPath = normalizeContextPath(file.path);
    if (!manifestPath || !manifestPath.endsWith('.context.json')) {
      indexDiagnostics.push(
        diagnostic(
          'invalid-manifest',
          'Manifest path must be a safe repository-relative path ending in .context.json',
          manifestPath
        )
      );
      continue;
    }
    if (isIgnored(manifestPath, input.ignoredPaths)) {
      indexDiagnostics.push(
        diagnostic(
          'ignored-manifest',
          'Ignored manifest was excluded from feature context',
          manifestPath
        )
      );
      continue;
    }
    const resolvedManifest = await resolveContainedFile(rootRealPath, manifestPath);
    if (resolvedManifest.status !== 'found') {
      indexDiagnostics.push(
        diagnostic(
          resolvedManifest.status === 'outside-root' ? 'path-outside-root' : 'manifest-not-found',
          resolvedManifest.status === 'outside-root'
            ? 'Manifest resolves outside the repository'
            : 'Manifest is missing or unreadable',
          manifestPath
        )
      );
      continue;
    }
    const actualText = resolvedManifest.bytes.toString('utf8');
    if (actualText !== file.text) {
      indexDiagnostics.push(
        diagnostic(
          'invalid-manifest',
          'Manifest changed while index input was being collected; refresh the index',
          manifestPath
        )
      );
      continue;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(actualText) as unknown;
    } catch (error) {
      indexDiagnostics.push(
        diagnostic(
          'invalid-manifest',
          error instanceof Error ? error.message : 'Invalid JSON',
          manifestPath
        )
      );
      continue;
    }
    const manifestResult = FeatureContextManifestSchema.safeParse(parsedJson);
    if (!manifestResult.success) {
      indexDiagnostics.push(
        diagnostic('invalid-manifest', manifestResult.error.message, manifestPath)
      );
      continue;
    }
    const manifest = manifestResult.data;
    const manifestHash = sha256(resolvedManifest.bytes);

    for (const attachment of manifest.attachments) {
      if (attachments.length >= MAX_INDEX_ATTACHMENTS) {
        omittedAttachments += 1;
        continue;
      }
      const attachmentDiagnostics: ContextDiagnostic[] = [];
      const sourceFile = await resolveContainedFile(rootRealPath, attachment.source.path);
      if (sourceFile.status !== 'found') {
        attachmentDiagnostics.push(
          diagnostic(
            sourceFile.status === 'outside-root' ? 'path-outside-root' : 'missing-source',
            sourceFile.status === 'outside-root'
              ? `Requirement source resolves outside the repository: ${attachment.source.path}`
              : `Requirement source is missing or unreadable: ${attachment.source.path}`,
            attachment.source.path
          )
        );
      }
      const sourceHash = sourceFile.status === 'found' ? sha256(sourceFile.bytes) : undefined;
      const sourceStatus =
        sourceFile.status === 'found'
          ? validateSourceLocator(attachment.source, attachment.requirementId, sourceFile.bytes)
          : 'missing';
      if (sourceStatus === 'invalid' || sourceStatus === 'unsupported') {
        attachmentDiagnostics.push(
          diagnostic(
            sourceStatus === 'invalid' ? 'invalid-source-locator' : 'unsupported-source-locator',
            sourceStatus === 'invalid'
              ? 'Requirement locator does not identify exactly one matching source ID'
              : 'Requirement locator or source format cannot be validated',
            attachment.source.path
          )
        );
      }
      const appliesTo = [] as FeatureContextIndex['attachments'][number]['appliesTo'];
      for (const target of attachment.appliesTo) {
        const targetFile = await resolveContainedFile(rootRealPath, target.path, {
          ...(target.symbol ? { maxBytes: MAX_TREE_SITTER_PARSE_BYTES } : {}),
          digestOnly: true
        });
        const targetExists =
          targetFile.status === 'found' ||
          targetFile.status === 'digested' ||
          targetFile.status === 'too-large';
        if (targetFile.status === 'outside-root') {
          attachmentDiagnostics.push(
            diagnostic(
              'path-outside-root',
              `Target resolves outside the repository: ${target.path}`,
              target.path
            )
          );
        }
        const compiled = resolveDeclaredTarget(
          target,
          symbols,
          targetExists,
          !incompleteSymbolPaths.has(target.path) &&
            targetFile.status !== 'too-large' &&
            (!target.symbol ||
              !symbolSourceDigests.has(target.path) ||
              (targetFile.status === 'digested' &&
                targetFile.sha256 === symbolSourceDigests.get(target.path))),
          target.symbol ? ambiguousSymbolKeys.has(`${target.path}\0${target.symbol}`) : false,
          target.symbol ? unresolvedSymbolBindings.has(`${target.path}\0${target.symbol}`) : false
        );
        const targetDiagnostic = targetStatusDiagnostic(target, compiled.status);
        if (targetDiagnostic) attachmentDiagnostics.push(targetDiagnostic);
        const targetDigest =
          targetFile.status === 'digested'
            ? targetFile.sha256
            : targetFile.status === 'found'
              ? sha256(targetFile.bytes)
              : undefined;
        appliesTo.push({
          ...compiled,
          ...(targetDigest ? { sha256: targetDigest } : {})
        });
      }
      const declaredTests = [] as FeatureContextIndex['attachments'][number]['declaredTests'];
      for (const test of attachment.declaredTests) {
        const testFile = await resolveContainedFile(rootRealPath, test.path);
        if (testFile.status !== 'found') {
          attachmentDiagnostics.push(
            diagnostic(
              testFile.status === 'outside-root' ? 'path-outside-root' : 'missing-target',
              `Declared test file is missing or unsafe: ${test.path}`,
              test.path
            )
          );
        }
        declaredTests.push({
          test,
          ...(testFile.status === 'found' ? { sha256: sha256(testFile.bytes) } : {})
        });
      }
      const recordedEvidence = [] as FeatureContextIndex['attachments'][number]['recordedEvidence'];
      for (const receiptPath of attachment.evidenceReceipts) {
        const receiptText = receiptTextByPath.get(receiptPath);
        const receiptFile = await resolveContainedFile(rootRealPath, receiptPath);
        const receiptDiagnostics: ContextDiagnostic[] = [];
        if (!receiptText || receiptFile.status !== 'found') {
          receiptDiagnostics.push(
            diagnostic(
              receiptFile.status === 'outside-root' ? 'path-outside-root' : 'missing-receipt',
              `Receipt is missing, unreadable, or unsafe: ${receiptPath}`,
              receiptPath
            )
          );
          attachmentDiagnostics.push(...receiptDiagnostics);
          recordedEvidence.push({ path: receiptPath, diagnostics: receiptDiagnostics });
          continue;
        }
        if (receiptFile.status !== 'found') continue;
        if (receiptFile.bytes.toString('utf8') !== receiptText) {
          receiptDiagnostics.push(
            diagnostic(
              'invalid-receipt',
              'Receipt changed while index input was being collected',
              receiptPath
            )
          );
          attachmentDiagnostics.push(...receiptDiagnostics);
          recordedEvidence.push({
            path: receiptPath,
            sha256: sha256(receiptFile.bytes),
            diagnostics: receiptDiagnostics
          });
          continue;
        }
        let receiptJson: unknown;
        try {
          receiptJson = JSON.parse(receiptText) as unknown;
        } catch (error) {
          receiptDiagnostics.push(
            diagnostic(
              'invalid-receipt',
              error instanceof Error ? error.message : 'Invalid receipt JSON',
              receiptPath
            )
          );
        }
        const receiptResult = CapturedRunReceiptSchema.safeParse(receiptJson);
        if (!receiptResult.success) {
          receiptDiagnostics.push(
            diagnostic('invalid-receipt', receiptResult.error.message, receiptPath)
          );
        }
        if (receiptResult.success) {
          const receipt = receiptResult.data;
          if (
            receipt.source.path !== attachment.source.path ||
            receipt.source.sha256.toLowerCase() !== sourceHash?.toLowerCase()
          ) {
            receiptDiagnostics.push(
              diagnostic(
                'invalid-receipt',
                'Receipt requirement source does not match this attachment',
                receiptPath
              )
            );
          }
          if (!attachment.declaredTests.some((test) => equalTest(test, receipt.test))) {
            receiptDiagnostics.push(
              diagnostic(
                'invalid-receipt',
                'Receipt test is not explicitly declared by this attachment',
                receiptPath
              )
            );
          }
          if (receipt.outcome !== 'passed') {
            receiptDiagnostics.push(
              diagnostic(
                'run-not-passed',
                `Recorded runner outcome is ${receipt.outcome}`,
                receiptPath
              )
            );
          }
          const reportFile = await resolveContainedFile(rootRealPath, receipt.report.path);
          const reportHash = reportFile.status === 'found' ? sha256(reportFile.bytes) : undefined;
          if (reportFile.status !== 'found') {
            receiptDiagnostics.push(
              diagnostic(
                reportFile.status === 'outside-root' ? 'path-outside-root' : 'missing-report',
                `Report is missing, unreadable, or unsafe: ${receipt.report.path}`,
                receipt.report.path
              )
            );
          } else if (reportHash?.toLowerCase() !== receipt.report.sha256.toLowerCase()) {
            receiptDiagnostics.push(
              diagnostic(
                'invalid-receipt',
                'Report digest does not match the referenced report',
                receipt.report.path
              )
            );
          }
          if (!input.codeCommit)
            receiptDiagnostics.push(
              diagnostic(
                'git-unavailable',
                'Evidence is not current because the checkout commit is unavailable',
                receiptPath
              )
            );
          else if (
            !input.codeIsClean ||
            input.codeCommit.toLowerCase() !== receipt.code.commit.toLowerCase()
          ) {
            receiptDiagnostics.push(
              diagnostic(
                input.codeIsClean ? 'stale-evidence' : 'dirty-code',
                'Evidence is not current for this clean checkout commit',
                receiptPath
              )
            );
          }
          recordedEvidence.push({
            path: receiptPath,
            sha256: sha256(receiptFile.bytes),
            receipt,
            ...(reportHash ? { reportSha256: reportHash } : {}),
            diagnostics: receiptDiagnostics
          });
        } else {
          recordedEvidence.push({
            path: receiptPath,
            sha256: sha256(receiptFile.bytes),
            diagnostics: receiptDiagnostics
          });
        }
        attachmentDiagnostics.push(...receiptDiagnostics);
      }
      attachments.push({
        manifestPath,
        manifestSha256: manifestHash,
        requirementId: attachment.requirementId,
        source: {
          ...attachment.source,
          status: sourceStatus,
          ...(sourceHash ? { sha256: sourceHash } : {})
        },
        appliesTo,
        declaredTests,
        recordedEvidence,
        diagnostics: attachmentDiagnostics
      });
    }
  }

  if (omittedAttachments > 0) {
    indexDiagnostics.push(
      diagnostic(
        'matches-omitted',
        `${omittedAttachments} attachments omitted from the feature context index limit.`
      )
    );
  }
  if (indexDiagnostics.length > MAX_INDEX_DIAGNOSTICS) {
    const omittedDiagnostics = indexDiagnostics.length - MAX_INDEX_DIAGNOSTICS + 1;
    indexDiagnostics.splice(MAX_INDEX_DIAGNOSTICS - 1);
    indexDiagnostics.push(
      diagnostic(
        'diagnostics-truncated',
        `${omittedDiagnostics} index diagnostics omitted by the index limit.`
      )
    );
  }

  return FeatureContextIndexSchema.parse({
    schemaVersion: 1,
    code: { commit: input.codeCommit, clean: input.codeIsClean },
    attachments,
    diagnostics: indexDiagnostics
  });
}

function targetMatches(declared: FeatureTarget, query: FeatureTarget): boolean {
  if (declared.path !== query.path) return false;
  if (!query.symbol) return true;
  return declared.symbol === undefined || declared.symbol === query.symbol;
}

async function currentFileDigest(
  rootRealPath: string,
  relativePath: string,
  maxBytes?: number
): Promise<string | undefined> {
  const file = await resolveContainedFile(rootRealPath, relativePath, {
    ...(maxBytes !== undefined ? { maxBytes } : {}),
    digestOnly: true
  });
  return file.status === 'digested' ? file.sha256 : undefined;
}

async function revalidateAttachment(
  rootRealPath: string,
  attachment: FeatureContextIndex['attachments'][number],
  currentGit: QueryFeatureContextInput['currentGit']
): Promise<FeatureContextReply['matches'][number]> {
  const diagnostics = [...attachment.diagnostics];
  const manifestDigest = await currentFileDigest(rootRealPath, attachment.manifestPath);
  const manifestCurrent = manifestDigest === attachment.manifestSha256;
  if (!manifestCurrent)
    diagnostics.push(
      diagnostic(
        'stale-manifest',
        `Manifest changed or is unavailable: ${attachment.manifestPath}`,
        attachment.manifestPath
      )
    );
  const sourceDigest = attachment.source.sha256
    ? await currentFileDigest(rootRealPath, attachment.source.path)
    : undefined;
  const sourceBytesCurrent = Boolean(sourceDigest && sourceDigest === attachment.source.sha256);
  const sourceStatus = attachment.source.status ?? 'unsupported';
  const sourceCurrent = manifestCurrent && sourceBytesCurrent && sourceStatus === 'resolved';
  if (!attachment.source.status)
    diagnostics.push(
      diagnostic(
        'unsupported-source-locator',
        'Source locator was not validated; refresh the index',
        attachment.source.path
      )
    );
  if (!sourceBytesCurrent)
    diagnostics.push(
      diagnostic(
        'stale-source',
        `Requirement source changed or is unavailable: ${attachment.source.path}`,
        attachment.source.path
      )
    );

  const appliesTo = [] as FeatureContextReply['matches'][number]['appliesTo'];
  for (const target of attachment.appliesTo) {
    const currentDigest = target.sha256
      ? await currentFileDigest(
          rootRealPath,
          target.target.path,
          target.target.symbol ? MAX_TREE_SITTER_PARSE_BYTES : undefined
        )
      : undefined;
    const current = Boolean(currentDigest && currentDigest === target.sha256);
    if (!current)
      diagnostics.push(
        diagnostic(
          'stale-target',
          `Target changed or is unavailable: ${target.target.path}`,
          target.target.path
        )
      );
    appliesTo.push({
      target: target.target,
      status: target.status,
      ...(target.identity ? { identity: target.identity } : {}),
      current
    });
  }

  const declaredTests = [] as FeatureContextReply['matches'][number]['declaredTests'];
  for (const test of attachment.declaredTests) {
    const currentDigest = test.sha256
      ? await currentFileDigest(rootRealPath, test.test.path)
      : undefined;
    const current = Boolean(currentDigest && currentDigest === test.sha256);
    if (!current)
      diagnostics.push(
        diagnostic(
          'stale-test',
          `Declared test changed or is unavailable: ${test.test.path}`,
          test.test.path
        )
      );
    declaredTests.push({ test: test.test, current });
  }

  const recordedEvidence = [] as FeatureContextReply['matches'][number]['recordedEvidence'];
  for (const stored of attachment.recordedEvidence) {
    const evidenceDiagnostics = [...stored.diagnostics];
    let fresh = Boolean(
      stored.receipt && stored.reportSha256 && stored.sha256 && stored.diagnostics.length === 0
    );
    const receiptDigest = stored.sha256
      ? await currentFileDigest(rootRealPath, stored.path)
      : undefined;
    if (!receiptDigest || receiptDigest !== stored.sha256) {
      fresh = false;
      evidenceDiagnostics.push(
        diagnostic(
          'stale-evidence',
          `Receipt changed or is unavailable: ${stored.path}`,
          stored.path
        )
      );
    }
    const receipt = stored.receipt;
    if (receipt) {
      const receiptBindingIsValid =
        receipt.source.path === attachment.source.path &&
        receipt.source.sha256.toLowerCase() === attachment.source.sha256?.toLowerCase() &&
        attachment.declaredTests.some((item) => equalTest(item.test, receipt.test));
      if (!receiptBindingIsValid) {
        fresh = false;
        evidenceDiagnostics.push(
          diagnostic(
            'invalid-receipt',
            'Receipt source or test is not declared by this attachment',
            stored.path
          )
        );
      }
      if (receipt.outcome !== 'passed') {
        fresh = false;
        evidenceDiagnostics.push(
          diagnostic('run-not-passed', `Recorded runner outcome is ${receipt.outcome}`, stored.path)
        );
      }
      const reportDigest = await currentFileDigest(rootRealPath, receipt.report.path);
      if (
        !reportDigest ||
        reportDigest.toLowerCase() !== receipt.report.sha256.toLowerCase() ||
        reportDigest.toLowerCase() !== stored.reportSha256?.toLowerCase()
      ) {
        fresh = false;
        evidenceDiagnostics.push(
          diagnostic(
            'stale-evidence',
            `Report changed or is unavailable: ${receipt.report.path}`,
            receipt.report.path
          )
        );
      }
      const currentSourceDigest = await currentFileDigest(rootRealPath, receipt.source.path);
      if (
        !currentSourceDigest ||
        currentSourceDigest.toLowerCase() !== receipt.source.sha256.toLowerCase()
      )
        fresh = false;
      if (!currentGit.commit) {
        fresh = false;
        evidenceDiagnostics.push(
          diagnostic(
            'git-unavailable',
            'Evidence is not current because the checkout commit is unavailable',
            stored.path
          )
        );
      } else if (
        !currentGit.isClean ||
        currentGit.commit.toLowerCase() !== receipt.code.commit.toLowerCase()
      ) {
        fresh = false;
        evidenceDiagnostics.push(
          diagnostic(
            currentGit.isClean ? 'stale-evidence' : 'dirty-code',
            'Evidence is not current for this clean checkout commit',
            stored.path
          )
        );
      }
      if (!currentGit.isClean) fresh = false;
      if (
        !manifestCurrent ||
        !sourceCurrent ||
        appliesTo.some((item) => !item.current) ||
        declaredTests.some((item) => !item.current)
      )
        fresh = false;
      if (receipt.outcome !== 'passed') fresh = false;
    }
    if (!fresh && evidenceDiagnostics.length === 0)
      evidenceDiagnostics.push(
        diagnostic('stale-evidence', 'Evidence failed query-time freshness checks', stored.path)
      );
    diagnostics.push(...evidenceDiagnostics);
    recordedEvidence.push({
      receiptPath: stored.path,
      ...(receipt ? { runId: receipt.runId, outcome: receipt.outcome } : {}),
      fresh,
      ...(receipt && stored.reportSha256
        ? { report: { path: receipt.report.path, sha256: stored.reportSha256 } }
        : {}),
      diagnostics: evidenceDiagnostics
    });
  }

  return {
    requirementId: attachment.requirementId,
    manifestPath: attachment.manifestPath,
    source: {
      path: attachment.source.path,
      locator: attachment.source.locator,
      status: sourceStatus,
      ...(attachment.source.sha256 ? { sha256: attachment.source.sha256 } : {}),
      current: sourceCurrent
    },
    appliesTo,
    declaredTests,
    recordedEvidence,
    diagnostics
  };
}

function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 3);
}

function countAttachmentDiagnostics(attachment: FeatureContextReply['matches'][number]): number {
  return (
    attachment.diagnostics.length +
    attachment.recordedEvidence.reduce((count, evidence) => count + evidence.diagnostics.length, 0)
  );
}

export async function queryFeatureContext(
  input: QueryFeatureContextInput
): Promise<FeatureContextReply> {
  const indexResult = FeatureContextIndexSchema.safeParse(input.index);
  const targetResult = FeatureTargetSchema.safeParse(input.target);
  if (!indexResult.success || !targetResult.success) {
    throw new Error('Invalid feature context query input');
  }
  const rootRealPath = await fs.realpath(input.rootPath);
  const target = targetResult.data;
  const allMatches = indexResult.data.attachments.filter((attachment) =>
    attachment.appliesTo.some((declared) => targetMatches(declared.target, target))
  );
  const matches: FeatureContextReply['matches'] = [];
  for (const attachment of allMatches) {
    matches.push(await revalidateAttachment(rootRealPath, attachment, input.currentGit));
  }
  const diagnostics = [...indexResult.data.diagnostics];
  if (!input.currentGit.commit)
    diagnostics.push(diagnostic('git-unavailable', 'Current Git identity is unavailable'));
  if (!input.currentGit.isClean)
    diagnostics.push(
      diagnostic('dirty-code', 'Working tree is dirty; recorded evidence is not current')
    );
  if (indexResult.data.code.commit !== input.currentGit.commit) {
    diagnostics.push(
      diagnostic('index-refresh-required', 'Index was compiled for a different Git commit')
    );
  }
  const tokenLimit = Math.min(
    MAX_REPLY_TOKENS,
    Math.max(100, input.tokenLimit ?? MAX_REPLY_TOKENS)
  );
  const total = matches.length;
  const totalDiagnosticCount =
    diagnostics.length +
    matches.reduce((count, item) => count + countAttachmentDiagnostics(item), 0);
  const globalVisible = diagnostics.slice(0, MAX_DIAGNOSTICS_IN_REPLY - 1);
  const makeReply = (retained: FeatureContextReply['matches']): FeatureContextReply => {
    const omitted = total - retained.length;
    const visibleNestedDiagnostics = retained.reduce(
      (count, item) => count + countAttachmentDiagnostics(item),
      0
    );
    const omittedDiagnostics = Math.max(
      0,
      totalDiagnosticCount - globalVisible.length - visibleNestedDiagnostics
    );
    const replyDiagnostics = [...globalVisible];
    const globalOmitted = diagnostics.length - globalVisible.length;
    if (globalOmitted > 0) {
      replyDiagnostics.push(
        diagnostic(
          'diagnostics-truncated',
          `${globalOmitted} index or query diagnostics omitted; diagnostic count is exact.`
        )
      );
    }
    if (omitted > 0) {
      replyDiagnostics.push(
        diagnostic(
          'matches-omitted',
          `${omitted} matching attachments omitted by the response budget; match count is exact.`
        )
      );
    }
    return {
      schemaVersion: 1,
      target,
      matches: retained,
      counts: {
        matches: total,
        resolved: matches.filter(
          (item) =>
            item.source.current &&
            item.appliesTo.some(
              (ref) => targetMatches(ref.target, target) && ref.status === 'resolved' && ref.current
            )
        ).length,
        diagnostics: totalDiagnosticCount,
        omitted,
        omittedDiagnostics
      },
      truncated:
        omitted > 0 ||
        omittedDiagnostics > 0 ||
        retained.some((item) => item.omitted !== undefined),
      diagnostics: replyDiagnostics
    };
  };

  const retained: FeatureContextReply['matches'] = [];
  for (const match of matches) {
    if (retained.length >= 100) continue;
    const candidate = makeReply([...retained, match]);
    if (estimateTokens(candidate) <= tokenLimit) {
      retained.push(match);
      continue;
    }
    const targetRefs = match.appliesTo.filter((ref) => targetMatches(ref.target, target));
    const selected = targetRefs.find((ref) => ref.target.symbol === target.symbol) ?? targetRefs[0];
    if (!selected) continue;
    const selectedDiagnostic = targetStatusDiagnostic(selected.target, selected.status);
    const important = match.diagnostics.filter(
      (entry) =>
        (entry.path === target.path &&
          [
            'missing-target',
            'stale-target',
            'ambiguous-target',
            'unsupported-symbol',
            'path-outside-root'
          ].includes(entry.code) &&
          (!['unsupported-symbol', 'ambiguous-target'].includes(entry.code) ||
            (entry.code === selectedDiagnostic?.code &&
              entry.message === selectedDiagnostic.message))) ||
        (entry.path === match.source.path &&
          [
            'invalid-source-locator',
            'unsupported-source-locator',
            'missing-source',
            'stale-source',
            'path-outside-root'
          ].includes(entry.code))
    );
    const targetDiagnostics = important.filter((entry) => entry.path === target.path);
    const sourceDiagnostics = important.filter((entry) => entry.path !== target.path);
    const compact = {
      ...match,
      appliesTo: [selected],
      declaredTests: [],
      recordedEvidence: [],
      diagnostics: [
        ...targetDiagnostics.slice(0, 1),
        ...sourceDiagnostics.slice(0, 1),
        ...targetDiagnostics.slice(1),
        ...sourceDiagnostics.slice(1)
      ].slice(0, 2),
      omitted: {
        appliesTo: match.appliesTo.length - 1,
        declaredTests: match.declaredTests.length,
        recordedEvidence: match.recordedEvidence.length
      }
    };
    while (
      estimateTokens(makeReply([...retained, compact])) > tokenLimit &&
      globalVisible.length > 0
    ) {
      globalVisible.pop();
    }
    if (estimateTokens(makeReply([...retained, compact])) <= tokenLimit) retained.push(compact);
  }
  while (estimateTokens(makeReply(retained)) > tokenLimit && globalVisible.length > 0)
    globalVisible.pop();
  return FeatureContextReplySchema.parse(makeReply(retained));
}
