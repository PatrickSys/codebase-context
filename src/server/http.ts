/**
 * Per-request MCP HTTP endpoint. Both protocol eras use fresh servers;
 * application indexes may be shared, transport sessions are never retained.
 */
import { createServer as createHttpServer } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createServer, type RegisterHandlers } from './factory.js';

export type HttpServerOptions = {
  name: string;
  version: string;
  host?: string;
  port?: number;
  registerHandlers: RegisterHandlers;
};

export type HttpServerHandle = {
  /** Actual bound port (also supports ephemeral port 0 for wire tests). */
  port: number;
  close: () => Promise<void>;
};

export async function startHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 3100;
  // Keep 2025 initialize + stateless POST compatibility, not sessionful SSE.
  const handler = createMcpHandler(
    () => createServer({ name: options.name, version: options.version }, options.registerHandlers),
    { legacy: 'stateless', responseMode: 'json' }
  );
  const nodeHandler = toNodeHandler(handler);
  const httpServer = createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      if (url.pathname !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      await nodeHandler(req, res);
    } catch (error) {
      console.error('[HTTP] Unhandled request error:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      } else {
        res.destroy();
      }
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, resolve);
    });
  } catch (error) {
    await handler.close();
    throw error;
  }
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('HTTP server has no bound port');
  console.error('Codebase Context MCP server listening on http://' + host + ':' + address.port + '/mcp');
  return {
    port: address.port,
    close: async () => {
      // Stop admission before disposing any handler resources.
      const closed = new Promise<void>((resolve, reject) =>
        httpServer.close(error => error ? reject(error) : resolve())
      );
      await handler.close();
      await closed;
    }
  };
}
