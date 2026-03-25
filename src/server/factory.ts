/**
 * Server factory for creating MCP Server instances.
 *
 * Decouples Server instantiation from handler registration so both
 * stdio and HTTP transports can create fresh Server instances that
 * share the same handler logic (which lives in index.ts and closes
 * over module-level state).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';

export type ServerOptions = {
  name: string;
  version: string;
};

export type RegisterHandlers = (server: Server) => void;

/**
 * Create a new MCP Server instance with standard capabilities.
 * Optionally registers handlers via the provided callback.
 */
export function createServer(
  options: ServerOptions,
  registerHandlers?: RegisterHandlers
): Server {
  const server = new Server(
    {
      name: options.name,
      version: options.version
    },
    {
      capabilities: {
        tools: {},
        resources: {}
      }
    }
  );

  if (registerHandlers) {
    registerHandlers(server);
  }

  return server;
}
