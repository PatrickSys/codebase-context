import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolContext, ToolResponse } from './types.js';
import type { Memory, MemoryCategory, MemoryScope, MemoryType } from '../types/index.js';
import {
  appendMemoryFile,
  buildMemoryIdentityParts,
  normalizeMemoryScope
} from '../memory/store.js';

export const definition: Tool = {
  name: 'remember',
  description:
    'CALL IMMEDIATELY when user explicitly asks to remember/record something.\n\n' +
    'USER TRIGGERS:\n' +
    '- "Remember this: [X]"\n' +
    '- "Record this: [Y]"\n' +
    '- "Save this for next time: [Z]"\n\n' +
    'DO NOT call unless user explicitly requests it.\n\n' +
    'HOW TO WRITE:\n' +
    '- ONE convention per memory (if user lists 5 things, call this 5 times)\n' +
    '- memory: 5-10 words (the specific rule)\n' +
    '- reason: 1 sentence (why it matters)\n' +
    '- Skip: one-time features, code examples, essays',
  inputSchema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['convention', 'decision', 'gotcha', 'failure'],
        description:
          'Type of memory being recorded. Use "failure" for things that were tried and failed - ' +
          'prevents repeating the same mistakes.'
      },
      category: {
        type: 'string',
        description: 'Broader category for filtering',
        enum: ['tooling', 'architecture', 'testing', 'dependencies', 'conventions']
      },
      memory: {
        type: 'string',
        description: 'What to remember (concise)'
      },
      reason: {
        type: 'string',
        description: 'Why this matters or what breaks otherwise'
      },
      scope: {
        type: 'object',
        description:
          'Optional scope for this memory. Use { kind: "file", file } or { kind: "symbol", file, symbol }.',
        properties: {
          kind: {
            type: 'string',
            enum: ['global', 'file', 'symbol']
          },
          file: {
            type: 'string'
          },
          symbol: {
            type: 'string'
          }
        }
      }
    },
    required: ['type', 'category', 'memory', 'reason']
  }
};

export async function handle(
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResponse> {
  const args_typed = args as {
    type?: MemoryType;
    category: MemoryCategory;
    memory: string;
    reason: string;
    scope?: MemoryScope;
  };

  const { type = 'decision', category, memory, reason } = args_typed;
  const scope = normalizeMemoryScope(args_typed.scope);

  try {
    const crypto = await import('crypto');
    const memoryPath = ctx.paths.memory;

    const hashContent = buildMemoryIdentityParts({ type, category, memory, reason, scope });
    const hash = crypto.createHash('sha256').update(hashContent).digest('hex');
    const id = hash.substring(0, 12);

    const newMemory: Memory = {
      id,
      type,
      category,
      memory,
      reason,
      date: new Date().toISOString(),
      ...(scope && { scope })
    };

    const result = await appendMemoryFile(memoryPath, newMemory);

    if (result.status === 'duplicate') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'info',
                message: 'This memory was already recorded.',
                memory: result.memory
              },
              null,
              2
            )
          }
        ]
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'success',
              message: 'Memory recorded successfully.',
              memory: result.memory
            },
            null,
            2
          )
        }
      ]
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: 'error',
              message: 'Failed to record memory.',
              error: error instanceof Error ? error.message : String(error)
            },
            null,
            2
          )
        }
      ]
    };
  }
}
