import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { CODEBASE_CONTEXT_DIRNAME, RELATIONSHIPS_FILENAME } from '../constants/codebase-context.js';
import {
  FeatureContextIndexSchema,
  FeatureTargetSchema,
  queryFeatureContext,
  readContainedFeatureContextFile
} from '../core/feature-context.js';
import {
  assertSafeFeatureContextArtifacts,
  readIndexMeta,
  validateIndexArtifacts
} from '../core/index-meta.js';
import type { ToolContext, ToolResponse } from './types.js';

const execFileAsync = promisify(execFile);
const RESPONSE_TOKEN_LIMIT = 900;

export const definition: Tool = {
  name: 'get_feature_context',
  description:
    'Retrieve explicitly linked requirements, rationale, code targets, declared tests, and revision-checked run evidence for one authored target path and optional supported JavaScript/TypeScript declaration. Source files, templates, imports, and shared dependencies are not implicitly matched. Duplicate declarations are ambiguous; unsupported declarations or same-name unresolved bindings are reported unsupported. Missing or stale index data is reported; it is never treated as no attachments.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Repository-relative POSIX path to an authored code or template target. Requirement-source paths and shared dependencies are not automatically target matches.'
      },
      symbol: {
        type: 'string',
        description:
          'Optional exact name of a supported JavaScript/TypeScript callable or type declaration; value-only variables and imports are not attachment symbols'
      }
    },
    required: ['path']
  }
};

function response(payload: Record<string, unknown>, isError = false): ToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {})
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function readCurrentGitIdentity(
  rootPath: string
): Promise<{ commit: string | null; isClean: boolean }> {
  try {
    const options = { cwd: rootPath, timeout: 5000, windowsHide: true, encoding: 'utf8' as const };
    const [commitResult, statusResult] = await Promise.allSettled([
      execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], options),
      execFileAsync('git', ['status', '--porcelain', '--untracked-files=normal'], options)
    ]);
    if (commitResult.status === 'rejected' || statusResult.status === 'rejected') {
      return { commit: null, isClean: false };
    }
    const commit = commitResult.value.stdout;
    const status = statusResult.value.stdout;
    const resolvedCommit = commit.trim();
    return {
      commit: resolvedCommit.length > 0 ? resolvedCommit : null,
      isClean: resolvedCommit.length > 0 && status.length === 0
    };
  } catch {
    // A missing/unreadable Git identity can never qualify recorded evidence as current.
    return { commit: null, isClean: false };
  }
}

export async function handle(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  const targetResult = FeatureTargetSchema.safeParse({
    path: args.path,
    ...(args.symbol !== undefined ? { symbol: args.symbol } : {})
  });
  if (!targetResult.success) {
    return response(
      {
        status: 'invalid_input',
        message:
          "'path' must be a normalized repository-relative POSIX path; 'symbol', when provided, must be non-empty."
      },
      true
    );
  }
  const target = targetResult.data;

  try {
    // This shared guard rejects a linked .codebase-context directory and linked index artifacts
    // before readIndexMeta/validateIndexArtifacts can follow them outside the repository.
    await assertSafeFeatureContextArtifacts(ctx.rootPath);
    const meta = await readIndexMeta(ctx.rootPath);
    await validateIndexArtifacts(ctx.rootPath, meta);

    // Recheck the cache boundary before obtaining the sidecar. The core reader resolves symlinks
    // and refuses any file whose real path escapes the repository root.
    await assertSafeFeatureContextArtifacts(ctx.rootPath);
    const sidecarFile = await readContainedFeatureContextFile(
      ctx.rootPath,
      `${CODEBASE_CONTEXT_DIRNAME}/${RELATIONSHIPS_FILENAME}`
    );
    if (sidecarFile.status !== 'found') {
      if (sidecarFile.status === 'missing') {
        return response({
          status: 'index_refresh_required',
          message: 'The relationships sidecar is missing. Run refresh_index.'
        });
      }
      return response(
        {
          status: 'index_unavailable',
          message: 'The relationships sidecar resolves outside the repository; refusing to read it.'
        },
        true
      );
    }

    let parsedSidecar: unknown;
    try {
      parsedSidecar = JSON.parse(sidecarFile.text) as unknown;
    } catch {
      return response(
        {
          status: 'index_invalid',
          message: 'The relationships sidecar is not valid JSON. Run refresh_index to rebuild it.'
        },
        true
      );
    }

    const sidecar = asObject(parsedSidecar);
    if (!sidecar || !Object.hasOwn(sidecar, 'featureContexts')) {
      return response({
        status: 'index_refresh_required',
        message: 'This index predates feature context. Run refresh_index to rebuild its sidecar.'
      });
    }

    const indexResult = FeatureContextIndexSchema.safeParse(sidecar.featureContexts);
    if (!indexResult.success) {
      return response(
        {
          status: 'index_invalid',
          message: 'The feature-context sidecar is invalid. Run refresh_index to rebuild it.'
        },
        true
      );
    }

    const currentGit = await readCurrentGitIdentity(ctx.rootPath);
    const warning = !currentGit.commit
      ? 'Current Git identity could not be established; recorded evidence cannot be fresh.'
      : !currentGit.isClean
        ? 'The current working tree is dirty; recorded evidence cannot be treated as fresh.'
        : undefined;
    const envelope = {
      status: 'success',
      rootPath: ctx.rootPath,
      ...(warning ? { warning } : {}),
      project: ctx.project ?? {
        project: ctx.rootPath,
        rootPath: ctx.rootPath,
        label: ctx.rootPath,
        active: false,
        source: 'root',
        indexStatus: 'ready'
      }
    };
    const envelopeTokens = Math.ceil(JSON.stringify(envelope).length / 3);
    const result = await queryFeatureContext({
      rootPath: ctx.rootPath,
      index: indexResult.data,
      target,
      currentGit,
      tokenLimit: Math.max(100, RESPONSE_TOKEN_LIMIT - envelopeTokens)
    });

    return response({
      status: 'success',
      // Other CBC tools expose the resolved project root as rootPath. Feature-context
      // paths are relative to this root, never to the MCP client's working directory.
      rootPath: ctx.rootPath,
      ...result,
      ...(warning ? { warning } : {})
    });
  } catch (error) {
    return response(
      {
        status: 'index_unavailable',
        message:
          error instanceof Error
            ? error.message
            : 'The feature-context index could not be safely validated. Run refresh_index.'
      },
      true
    );
  }
}
