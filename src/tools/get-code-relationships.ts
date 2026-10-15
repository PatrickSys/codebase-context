import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { RELATIONSHIPS_FILENAME } from '../constants/codebase-context.js';
import { readIndexMeta } from '../core/index-meta.js';
import {
  traverseFileGraphWithVerification,
  type FileGraphEdge,
  type ImportEdgeDetail,
  type UnresolvedImportEdge
} from '../utils/usage-tracker.js';
import {
  InternalSourceResolver,
  loadTsconfigCompilerOptions
} from '../utils/internal-source-resolver.js';
import type { ToolContext, ToolResponse } from './types.js';

const RESPONSE_BYTE_BUDGET = 4000;
const MAX_INSPECTIONS = 1000;
const MAX_DIAGNOSTICS = 20;

function serializeBoundedResponse(value: Record<string, unknown>): {
  text: string;
  truncated: boolean;
} {
  const bounded: Record<string, unknown> = { ...value };
  const collectionKeys = ['paths', 'unresolved', 'staleEdges', 'staleUnresolvedEdges'];
  for (const key of collectionKeys) {
    if (Array.isArray(bounded[key])) bounded[key] = [...bounded[key]];
  }
  let truncated = value.truncated === true;
  const encode = (): string => JSON.stringify(bounded);
  let payload = encode();
  const trimOrder = ['staleUnresolvedEdges', 'staleEdges', 'unresolved', 'paths'];
  while (Buffer.byteLength(payload, 'utf8') > RESPONSE_BYTE_BUDGET) {
    const key = trimOrder.find(
      (candidate) =>
        Array.isArray(bounded[candidate]) && (bounded[candidate] as unknown[]).length > 0
    );
    if (!key) {
      return {
        text: JSON.stringify({
          status: 'output_limited',
          truncated: true,
          message:
            'The relationship response exceeded its byte budget; narrow the starting file or hop limit.'
        }),
        truncated: true
      };
    }
    (bounded[key] as unknown[]).pop();
    truncated = true;
    bounded.truncated = true;
    bounded.outputNote = [
      value.outputNote,
      'The serialized response reached its 4000-byte budget; some paths or diagnostics were omitted. Narrow the starting file or hop limit for more.'
    ]
      .filter(Boolean)
      .join(' ');
    payload = encode();
  }
  return { text: payload, truncated };
}

export function finalizeRelationshipPayload(value: Record<string, unknown>): string {
  return serializeBoundedResponse(value).text;
}

export const definition: Tool = {
  name: 'get_code_relationships',
  description:
    'Follow verified import or re-export relationships up to three hops from one indexed file. Returns source lines and freshness diagnostics; imports never imply runtime calls.',
  inputSchema: {
    type: 'object',
    properties: {
      file: { type: 'string', description: 'Indexed repository-relative file path.' },
      direction: { type: 'string', enum: ['outgoing', 'incoming'] },
      max_hops: { type: 'number', description: 'Hop limit from 1 to 3; defaults to 2.' },
      max_nodes: { type: 'number', description: 'Output node cap from 1 to 100; defaults to 50.' }
    },
    required: ['file']
  }
};

interface Sidecar {
  header?: { buildId?: string; formatVersion?: number };
  graph?: {
    imports?: Record<string, string[]>;
    importDetails?: Record<string, Record<string, ImportEdgeDetail>>;
    exports?: Record<string, unknown>;
    unresolvedEdges?: UnresolvedImportEdge[];
  };
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeRelativePath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.startsWith('//') ||
    normalized.split('/').some((part) => part === '..')
  ) {
    return null;
  }
  return normalized;
}

function matchesRelativePath(root: string, absolute: string, expected: string): boolean {
  const relative = path.relative(root, absolute).replace(/\\/g, '/');
  return process.platform === 'win32'
    ? relative.toLowerCase() === expected.replace(/\\/g, '/').toLowerCase()
    : relative === expected.replace(/\\/g, '/');
}

async function resolveConfined(rootRealPath: string, relativePath: string): Promise<string | null> {
  const safe = safeRelativePath(relativePath);
  if (!safe) return null;
  try {
    const realPath = await fs.realpath(path.resolve(rootRealPath, ...safe.split('/')));
    const relative = path.relative(rootRealPath, realPath);
    return relative === '' ||
      (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
      ? realPath
      : null;
  } catch {
    return null;
  }
}

async function currentFingerprint(filePath: string): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

async function verifyEdge(
  rootRealPath: string,
  edge: FileGraphEdge,
  resolver: InternalSourceResolver
): Promise<boolean> {
  if (
    !edge.verified ||
    !edge.source.specifier ||
    !edge.source.sourceFingerprint ||
    !edge.source.targetFingerprint
  ) {
    return false;
  }
  const [from, to] = await Promise.all([
    resolveConfined(rootRealPath, edge.from),
    resolveConfined(rootRealPath, edge.to)
  ]);
  if (!from || !to) return false;
  const currentResolution = await resolver.resolve(from, edge.source.specifier, true);
  if (currentResolution.status !== 'resolved' || !currentResolution.path) return false;
  const currentTarget = await fs.realpath(currentResolution.path).catch(() => null);
  if (!currentTarget || !matchesRelativePath(rootRealPath, currentTarget, edge.to)) {
    return false;
  }
  const [fromFingerprint, toFingerprint] = await Promise.all([
    currentFingerprint(from),
    currentFingerprint(to)
  ]);
  return (
    fromFingerprint === edge.source.sourceFingerprint &&
    toFingerprint === edge.source.targetFingerprint
  );
}

export async function handle(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  const fileArg = typeof args.file === 'string' ? args.file : '';
  const direction = args.direction === 'incoming' ? 'incoming' : 'outgoing';
  const maxHops =
    args.max_hops === 1 || args.max_hops === 2 || args.max_hops === 3 ? args.max_hops : 2;
  const maxNodes =
    typeof args.max_nodes === 'number' && Number.isFinite(args.max_nodes)
      ? Math.max(1, Math.min(100, Math.floor(args.max_nodes)))
      : 50;
  const reply = (value: Record<string, unknown>, isError = false): ToolResponse => ({
    content: [{ type: 'text', text: finalizeRelationshipPayload(value) }],
    ...(isError ? { isError: true } : {})
  });

  try {
    const rootRealPath = await fs.realpath(ctx.rootPath);
    const start = safeRelativePath(fileArg);
    if (!start)
      return reply(
        { status: 'invalid_path', message: 'Provide a repository-relative file path.' },
        true
      );
    const startRealPath = await resolveConfined(rootRealPath, start);
    if (!startRealPath)
      return reply({
        status: 'not_indexed_or_outside_root',
        file: start,
        message: 'The requested file is missing or resolves outside this project root.'
      });

    const sidecarPath = path.join(path.dirname(ctx.paths.intelligence), RELATIONSHIPS_FILENAME);
    const parsed: unknown = JSON.parse(await fs.readFile(sidecarPath, 'utf8'));
    const sidecar = asObject(parsed) as Sidecar;
    const meta = await readIndexMeta(ctx.rootPath);
    if (!sidecar.header?.buildId || sidecar.header.buildId !== meta.buildId) {
      return reply({
        status: 'stale_index',
        message:
          'Relationship sidecar and index metadata have different build identities. Refresh the index before relying on graph results.'
      });
    }
    if (!sidecar.graph?.imports) {
      return reply({
        status: 'graph_unavailable',
        message: 'The current index has no file relationship graph. Refresh indexing to build it.'
      });
    }

    // Every edge is resolved against current confined files with allowUnindexed=true.
    // Avoid resolving every stored graph file during setup for a nearby relationship query.
    const resolver = await InternalSourceResolver.create(rootRealPath, [], {
      compilerOptions: loadTsconfigCompilerOptions(rootRealPath)
    });
    const verificationCache = new Map<string, boolean>();
    const result = await traverseFileGraphWithVerification(
      sidecar.graph,
      start,
      { direction, maxHops, maxNodes, maxPaths: 40, maxInspections: MAX_INSPECTIONS },
      async (edge) => {
        const proofKey = JSON.stringify([
          edge.from,
          edge.to,
          edge.kind,
          edge.source.specifier,
          edge.source.line,
          edge.source.sourceFingerprint,
          edge.source.targetFingerprint
        ]);
        let verified = verificationCache.get(proofKey);
        if (verified === undefined) {
          verified = await verifyEdge(rootRealPath, edge, resolver);
          verificationCache.set(proofKey, verified);
        }
        return verified;
      }
    );
    const staleEdges = result.rejectedEdges.slice(0, MAX_DIAGNOSTICS).map((edge) => ({
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
      line: edge.source.line,
      specifier: edge.source.specifier
    }));

    const unresolved: UnresolvedImportEdge[] = [];
    const staleUnresolvedEdges: UnresolvedImportEdge[] = [];
    for (const edge of result.unresolved) {
      const importer = await resolveConfined(rootRealPath, edge.from);
      const importerFingerprint = importer ? await currentFingerprint(importer) : null;
      if (importerFingerprint === edge.source.sourceFingerprint) unresolved.push(edge);
      else staleUnresolvedEdges.push(edge);
    }
    const stale = result.rejectedEdges.length > 0 || staleUnresolvedEdges.length > 0;
    const visiblePaths = result.paths;
    const visibleUnresolved = unresolved.slice(0, MAX_DIAGNOSTICS);
    const visibleStaleEdges = staleEdges;
    const visibleStaleUnresolved = staleUnresolvedEdges.slice(0, MAX_DIAGNOSTICS);
    const diagnosticsLimited =
      staleEdges.length < result.rejectedEdges.length ||
      visibleUnresolved.length < unresolved.length ||
      visibleStaleUnresolved.length < staleUnresolvedEdges.length;
    const outputLimited = result.truncated || diagnosticsLimited;
    return reply({
      status: stale ? 'stale_edges' : 'success',
      file: start,
      direction,
      maxHops,
      paths: visiblePaths.map((entry) => ({
        nodes: entry.nodes,
        edges: entry.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
          kind: edge.kind,
          source: { line: edge.source.line, specifier: edge.source.specifier }
        }))
      })),
      unresolved: visibleUnresolved.map((edge) => ({
        from: edge.from,
        kind: edge.kind,
        source: { line: edge.source.line, specifier: edge.source.specifier },
        reason: edge.reason
      })),
      ...(visibleStaleEdges.length > 0 ? { staleEdges: visibleStaleEdges } : {}),
      ...(visibleStaleUnresolved.length > 0
        ? {
            staleUnresolvedEdges: visibleStaleUnresolved.map((edge) => ({
              from: edge.from,
              kind: edge.kind,
              source: { line: edge.source.line, specifier: edge.source.specifier },
              reason: edge.reason
            }))
          }
        : {}),
      truncated: outputLimited,
      message: stale
        ? 'Some stored relationships could not be proven against current confined source files. Omitted those edges; refresh indexing to update this graph.'
        : unresolved.length > 0
          ? 'Resolved relationships are current. Unresolved source specifiers are diagnostics and were not followed.'
          : 'Relationships are limited to verified imports and re-exports; dynamic calls are not inferred.',
      ...(outputLimited
        ? {
            outputNote: result.inspectionLimited
              ? 'The relationship inspection budget was reached; additional relationships were not checked. Refresh indexing to remove stale edges, then retry from this file or a returned endpoint.'
              : result.truncated
                ? 'The accepted node or path cap was reached; narrow the hop limit or continue from a returned endpoint for more.'
                : 'Some freshness or unresolved diagnostics were omitted. Refresh indexing to update this graph.'
          }
        : {})
    });
  } catch (error) {
    return reply({
      status: 'graph_unavailable',
      message: 'Could not read a current relationship sidecar. Refresh indexing and retry.',
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}
