import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/**
 * Compatibility budget for tool arguments: count own object keys and array elements,
 * matching SDK 1.32's maxToolInputElements semantics. CBC tools use shallow objects
 * and search filters may contain a tags array; 10,000 allows generous headroom for
 * that array without leaving validation/dispatch unbounded (GHSA-46jr-4wx8-v453).
 * This is a finite policy, not an inferred maximum for unbounded tool schemas.
 */
export const MAX_TOOL_INPUT_ELEMENTS = 10_000;

/** Root arguments have depth 0. Current tool schemas need at most depth 2. */
export const MAX_TOOL_INPUT_DEPTH = 64;

/**
 * Check before project resolution or tool dispatch. Iterative traversal avoids call
 * stack exhaustion and stops at the first exceeded budget without logging inputs.
 * Scalar string bytes are not counted: this is not a stdio byte-size limit.
 */
export function assertToolInputWithinLimits(value: unknown): void {
  let elements = 0;
  const stack = [{ value, depth: 0 }];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.value === null || typeof node.value !== 'object') continue;
    if (node.depth > MAX_TOOL_INPUT_DEPTH) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Tool arguments exceed the maximum nesting depth'
      );
    }

    const visit = (child: unknown): void => {
      if (++elements > MAX_TOOL_INPUT_ELEMENTS) {
        throw new McpError(
          ErrorCode.InvalidParams,
          'Tool arguments exceed the maximum element count'
        );
      }
      if (child !== null && typeof child === 'object') {
        stack.push({ value: child, depth: node.depth + 1 });
      }
    };

    if (Array.isArray(node.value)) {
      for (const child of node.value) visit(child);
    } else {
      for (const key in node.value) {
        if (Object.prototype.hasOwnProperty.call(node.value, key)) {
          visit((node.value as Record<string, unknown>)[key]);
        }
      }
    }
  }
}
