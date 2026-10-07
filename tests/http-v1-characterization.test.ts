import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:net';
import { startHttpServer, type HttpServerHandle } from '../src/server/http.js';

let handle: HttpServerHandle | undefined;
afterEach(async () => { await handle?.close(); });
it('characterizes v1 HTTP: initialize creates a session; unknown sessions are rejected', async () => {
  const socket = createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  const port = address.port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  handle = await startHttpServer({ name: 'wire-baseline', version: '1', port, registerHandlers: () => {} });
  const url = 'http://127.0.0.1:' + port + '/mcp';
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  const init = await fetch(url, { method: 'POST', headers, body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'baseline', version: '1' } }
  }) });
  expect(init.status).toBe(200);
  expect(init.headers.get('mcp-session-id')).toBeTruthy();
  await init.text();
  const unknown = await fetch(url, { method: 'POST', headers: { ...headers, 'Mcp-Session-Id': 'unknown' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
  expect(unknown.status).toBe(404);
  await unknown.text();
});

