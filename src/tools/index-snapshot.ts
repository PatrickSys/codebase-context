import { withAvailableIndexSnapshot } from '../core/index-generation.js';
import { resolveProjectPaths } from '../project-state.js';
import type { ToolContext } from './types.js';

/** Keep derived paths and all nested readers on one operation-scoped build. */
export function withToolIndexSnapshot<T>(
  ctx: ToolContext,
  operation: (pinned: ToolContext) => Promise<T>
): Promise<T> {
  return withAvailableIndexSnapshot(ctx.rootPath, async () =>
    operation({
      ...ctx,
      paths: await resolveProjectPaths(ctx.rootPath)
    })
  );
}
