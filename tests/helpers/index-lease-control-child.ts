import { promises as fs } from 'node:fs';
import { once } from 'node:events';
import { withIndexWriter } from '../../src/core/index-generation.js';

const [mode, target] = process.argv.slice(2);
if (!target) throw new Error('Expected a fixture path');
const watchdog = setTimeout(() => process.exit(124), 8000);
try {
  if (mode === 'reader') {
    process.send?.({ type: 'ready' });
    const [request] = await once(process, 'message');
    if (
      !request ||
      typeof request !== 'object' ||
      !('target' in request) ||
      typeof request.target !== 'string'
    )
      throw new Error('Expected a ticket read target');
    const handle = await fs.open(request.target, 'r');
    try {
      process.send?.({ type: 'held', bytes: (await handle.readFile()).toString('utf8') });
      await once(process, 'message');
    } finally {
      await handle.close();
    }
    process.send?.({ type: 'closed' });
  } else if (mode === 'writer') {
    await withIndexWriter(target, async () => {
      process.send?.({ type: 'entered' });
      await once(process, 'message');
      process.send?.({ type: 'leaving', time: Date.now() });
    });
    process.send?.({ type: 'finished' });
  } else throw new Error('Unknown control mode');
} catch (error) {
  process.send?.({
    type: 'failed',
    message: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  process.disconnect?.();
}
