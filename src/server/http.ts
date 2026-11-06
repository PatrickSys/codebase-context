/**
 * HTTP transport for the MCP server.
 *
 * Starts a Node.js HTTP server that routes requests to /mcp using
 * StreamableHTTPServerTransport. Each client connection gets its own
 * MCP Server + Transport pair while sharing the same module-level
 * project state from index.ts.
 */

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './factory.js';
import type { RegisterHandlers } from './factory.js';

/** Session inactivity timeout in milliseconds (30 minutes) */
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/** How often to check for stale sessions (60 seconds) */
const SESSION_CHECK_INTERVAL_MS = 60 * 1000;

/** Preserve the SDK's compatible 4 MiB HTTP body ceiling explicitly. */
export const DEFAULT_MAX_REQUEST_BODY_SIZE = 4 * 1024 * 1024;

export type HttpServerOptions = {
  /** Server name for MCP protocol */
  name: string;
  /** Server version for MCP protocol */
  version: string;
  /** Host to bind to (default: 127.0.0.1) */
  host?: string;
  /** Port to listen on (default: 3100) */
  port?: number;
  /** Maximum HTTP request bytes, including chunked bodies (default: 4 MiB). */
  maxRequestBodySize?: number;
  /** Handler registration callback — wires tool/resource handlers onto each session's Server */
  registerHandlers: RegisterHandlers;
  /**
   * Called after each per-session Server is created and connected.
   * Use this to set up per-session notification handlers, roots refresh, etc.
   */
  onSessionReady?: (server: Server) => void;
};

type SessionEntry = {
  server: Server;
  transport: StreamableHTTPServerTransport;
  /** Last activity timestamp (ms since epoch) */
  lastActivity: number;
};

export type HttpServerHandle = {
  /** Close all sessions and shut down the HTTP server */
  close: () => Promise<void>;
};

export async function startHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 3100;
  const maxRequestBodySize = options.maxRequestBodySize ?? DEFAULT_MAX_REQUEST_BODY_SIZE;
  if (!Number.isSafeInteger(maxRequestBodySize) || maxRequestBodySize <= 0) {
    throw new RangeError('maxRequestBodySize must be a positive safe integer of bytes');
  }
  const sessions = new Map<string, SessionEntry>();

  function touchSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  function createSessionServer(): { server: Server; transport: StreamableHTTPServerTransport } {
    const server = createServer(
      { name: options.name, version: options.version },
      options.registerHandlers
    );

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      maxRequestBodySize
    });

    return { server, transport };
  }

  // Session timeout reaper — evicts sessions idle for > SESSION_TIMEOUT_MS.
  const timeoutCheck = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
      if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
        console.error(`[HTTP] Session ${sessionId} timed out`);
        void session.transport.close().catch(() => {
          /* best effort */
        });
        sessions.delete(sessionId);
      }
    }
  }, SESSION_CHECK_INTERVAL_MS);
  timeoutCheck.unref();

  const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}:${port}`);

      // Health check on root
      if (url.pathname === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', sessions: sessions.size }));
        return;
      }

      // Only handle /mcp
      if (url.pathname !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      const method = req.method?.toUpperCase();

      if (method === 'POST') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (sessionId && sessions.has(sessionId)) {
          // Existing session — delegate to its transport
          touchSession(sessionId);
          const session = sessions.get(sessionId)!;
          await session.transport.handleRequest(req, res);
          return;
        }

        if (sessionId && !sessions.has(sessionId)) {
          // Unknown session ID — 404
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }

        // No session ID — new initialization request
        const { server: mcpServer, transport } = createSessionServer();

        // Set before connect so the SDK chains its own Server cleanup callback.
        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && sessions.has(sid)) {
            sessions.delete(sid);
            console.error(`[HTTP] Session ${sid} disconnected`);
          }
        };

        let retained = false;
        try {
          await mcpServer.connect(transport);
          await transport.handleRequest(req, res);

          const newSessionId = transport.sessionId;
          if (newSessionId && res.statusCode < 400) {
            sessions.set(newSessionId, {
              server: mcpServer,
              transport,
              lastActivity: Date.now()
            });
            retained = true;
            console.error(`[HTTP] Session ${newSessionId} connected`);
            options.onSessionReady?.(mcpServer);
          }
        } finally {
          // Includes oversized/malformed initialization and connect/handler failures.
          // Closing the transport also runs the SDK's chained Server cleanup.
          if (!retained) await transport.close();
        }

        return;
      }

      if (method === 'GET') {
        // SSE streaming for server-initiated messages
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing or invalid session ID' }));
          return;
        }

        touchSession(sessionId);
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res);
        return;
      }

      if (method === 'DELETE') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        if (!sessionId || !sessions.has(sessionId)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }

        const session = sessions.get(sessionId)!;
        try {
          await session.transport.close();
        } finally {
          sessions.delete(sessionId);
          console.error(`[HTTP] Session ${sessionId} closed by client`);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'session_closed' }));
        return;
      }

      // Method not allowed
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    } catch (err) {
      console.error('[HTTP] Unhandled request error:', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
  });

  // Handle server errors
  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `[HTTP] Port ${port} is already in use. Choose a different port with --port or CODEBASE_CONTEXT_PORT.`
      );
    } else if (error.code === 'EACCES') {
      console.error(`[HTTP] Permission denied for port ${port}. Try a port above 1024.`);
    } else {
      console.error(`[HTTP] Server error: ${error.message}`);
    }
    process.exit(1);
  });

  return new Promise<HttpServerHandle>((resolve) => {
    httpServer.listen(port, host, () => {
      console.error(`Codebase Context MCP server listening on http://${host}:${port}/mcp`);

      const handle: HttpServerHandle = {
        close: async () => {
          // Stop the timeout reaper
          clearInterval(timeoutCheck);

          // Close all sessions
          for (const [sessionId, session] of sessions.entries()) {
            try {
              await session.transport.close();
              console.error(`[HTTP] Session ${sessionId} closed (shutdown)`);
            } catch {
              // Best effort
            }
            sessions.delete(sessionId);
          }

          // Shut down HTTP server
          return new Promise<void>((resolveClose, rejectClose) => {
            httpServer.close((err) => {
              if (err) rejectClose(err);
              else resolveClose();
            });
          });
        }
      };

      resolve(handle);
    });
  });
}
