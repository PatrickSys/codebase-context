import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from '../src/server/factory.js';
import { registerHandlers } from '../src/index.js';
import {
  assertToolInputWithinLimits,
  MAX_TOOL_INPUT_ELEMENTS,
  MAX_TOOL_INPUT_DEPTH
} from '../src/server/tool-input-limits.js';

const tools = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock('../src/tools/index.js', () => ({ TOOLS: [], dispatchTool: tools.dispatch }));

function nested(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = {};
  for (let i = 0; i < depth; i++) value = { child: value };
  return value;
}

async function withClient(run: (client: Client) => Promise<void>) {
  const server = createServer({ name: 'input-limit-test', version: '1' }, registerHandlers);
  const client = new Client({ name: 'input-limit-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  tools.dispatch.mockReset().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe('tool argument budgets', () => {
  it.each([undefined, null, false, 42, 'safe', {}, []])(
    'accepts empty/scalar input %j',
    (value) => {
      expect(() => assertToolInputWithinLimits(value)).not.toThrow();
    }
  );

  it.each([MAX_TOOL_INPUT_ELEMENTS - 1, MAX_TOOL_INPUT_ELEMENTS])(
    'accepts %i total elements including the containing object key',
    (count) => {
      expect(() =>
        assertToolInputWithinLimits({ tags: Array(count - 1).fill('safe') })
      ).not.toThrow();
    }
  );

  it('rejects one element over the limit', () => {
    expect(() =>
      assertToolInputWithinLimits({ tags: Array(MAX_TOOL_INPUT_ELEMENTS).fill('safe') })
    ).toThrow(expect.objectContaining({ code: ErrorCode.InvalidParams }));
  });

  it('counts own object keys, including keys whose values are scalar', () => {
    const value = Object.fromEntries(
      Array.from({ length: MAX_TOOL_INPUT_ELEMENTS }, (_, i) => [i, null])
    );
    expect(() => assertToolInputWithinLimits(value)).not.toThrow();
    value.extra = null;
    expect(() => assertToolInputWithinLimits(value)).toThrow();
  });

  it('sums nested array elements and object keys, counting empty containers as members', () => {
    const value = { tags: Array(MAX_TOOL_INPUT_ELEMENTS - 4).fill(null), filters: [{ tag: {} }] };
    expect(() => assertToolInputWithinLimits(value)).not.toThrow();
    value.tags.push(null);
    expect(() => assertToolInputWithinLimits(value)).toThrow();
  });

  it('ignores inherited object keys', () => {
    const value = Object.create(
      Object.fromEntries(Array.from({ length: MAX_TOOL_INPUT_ELEMENTS + 1 }, (_, i) => [i, null]))
    );
    value.own = 'safe';
    expect(() => assertToolInputWithinLimits(value)).not.toThrow();
  });

  it.each([MAX_TOOL_INPUT_DEPTH - 1, MAX_TOOL_INPUT_DEPTH])('accepts depth %i', (depth) => {
    expect(() => assertToolInputWithinLimits(nested(depth))).not.toThrow();
  });

  it('rejects excessive nesting without recursion', () => {
    expect(() => assertToolInputWithinLimits(nested(MAX_TOOL_INPUT_DEPTH + 1))).toThrow(
      expect.objectContaining({ code: ErrorCode.InvalidParams })
    );
    expect(() => assertToolInputWithinLimits(nested(MAX_TOOL_INPUT_ELEMENTS + 1))).toThrow();
  });

  it('accepts normal search filters, memory scope and relationship arguments', () => {
    for (const value of [
      {
        query: 'safe query',
        filters: { tags: ['a', 'b'], language: 'typescript' },
        project: '/repo'
      },
      {
        type: 'convention',
        memory: 'safe',
        reason: 'safe',
        scope: { kind: 'file', file: 'src/a.ts' }
      },
      { file: 'src/a.ts', direction: 'outgoing', max_hops: 3, max_nodes: 100 }
    ])
      expect(() => assertToolInputWithinLimits(value)).not.toThrow();
  });

  it('does not claim to bound scalar string bytes', () => {
    expect(() => assertToolInputWithinLimits({ memory: 'safe'.repeat(1024) })).not.toThrow();
  });
});

describe('shared tool handler input limit', () => {
  it('rejects excess elements with a bounded InvalidParams error before dispatch', async () => {
    await withClient(async (client) => {
      await expect(
        client.callTool({
          name: 'synthetic',
          arguments: { tags: Array(MAX_TOOL_INPUT_ELEMENTS).fill('private-marker') }
        })
      ).rejects.toMatchObject({
        code: ErrorCode.InvalidParams,
        message: expect.not.stringContaining('private-marker')
      });
      expect(tools.dispatch).not.toHaveBeenCalled();
    });
  });

  it('rejects excessive nesting before dispatch', async () => {
    await withClient(async (client) => {
      await expect(
        client.callTool({ name: 'synthetic', arguments: nested(MAX_TOOL_INPUT_DEPTH + 1) })
      ).rejects.toMatchObject({ code: ErrorCode.InvalidParams });
      expect(tools.dispatch).not.toHaveBeenCalled();
    });
  });

  it.each([MAX_TOOL_INPUT_ELEMENTS - 1, MAX_TOOL_INPUT_ELEMENTS])(
    'dispatches valid input at %i elements exactly once',
    async (count) => {
      await withClient(async (client) => {
        const result = await client.callTool({
          name: 'synthetic',
          arguments: { tags: Array(count - 1).fill('safe') }
        });
        expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
        expect(tools.dispatch).toHaveBeenCalledOnce();
      });
    }
  );
});
