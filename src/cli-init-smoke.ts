import { spawn } from 'node:child_process';
import path from 'node:path';

const INIT_REQUEST =
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"codebase-context-init","version":"0"}}}';

function frameMessage(body: string): string {
  const bytes = Buffer.byteLength(body, 'utf8');
  return `Content-Length: ${bytes}\r\n\r\n${body}`;
}

/**
 * Spawn the MCP server entrypoint and confirm it responds to initialize on stdio.
 */
export async function verifyMcpServerStarts(
  serverEntrypoint: string,
  rootPath: string,
  timeoutMs = 20_000
): Promise<void> {
  const entry = path.resolve(serverEntrypoint);
  const root = path.resolve(rootPath);
  const child = spawn(process.execPath, [entry, root], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, CODEBASE_CONTEXT_SKIP_UPDATE_NOTICE: '1' }
  });

  let buffer = '';
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timed out waiting for MCP initialize response.'));
    }, timeoutMs);

    const fail = (error: Error) => {
      clearTimeout(timer);
      reject(error);
    };

    child.on('error', fail);
    child.stderr?.on('data', () => undefined);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;
        const header = buffer.slice(0, headerEnd);
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }
        const length = Number.parseInt(match[1] ?? '', 10);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + length) break;
        const body = buffer.slice(bodyStart, bodyStart + length);
        buffer = buffer.slice(bodyStart + length);
        try {
          const parsed = JSON.parse(body) as { id?: number; result?: unknown; error?: unknown };
          if (parsed.id === 1 && (parsed.result !== undefined || parsed.error !== undefined)) {
            clearTimeout(timer);
            resolve();
            return;
          }
        } catch {
          // keep reading
        }
      }
    });

    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        fail(new Error(`MCP server exited before initialize (code ${code}).`));
      }
    });
  });

  child.stdin?.write(frameMessage(INIT_REQUEST));
  child.stdin?.write(frameMessage('{"jsonrpc":"2.0","method":"notifications/initialized"}'));

  try {
    await done;
  } finally {
    child.kill('SIGTERM');
  }
}
