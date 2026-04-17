import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';

const execFileAsync = promisify(execFile);

async function loadSdkClient() {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client'),
    import('@modelcontextprotocol/sdk/client/stdio.js')
  ]);

  return { Client, StdioClientTransport };
}

function createTimeoutError(timeoutMs) {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return new Error(`MCP client connect timed out after ${seconds}s`);
}

function withTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(createTimeoutError(timeoutMs)), timeoutMs);
    timer.unref?.();
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function delay(timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await delay(50);
  }

  return !isProcessAlive(pid);
}

async function killProcessTree(pid) {
  if (!isProcessAlive(pid)) {
    return;
  }

  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 10_000
      });
    } catch {
      // Best-effort fallback below.
    }
  }

  if (!isProcessAlive(pid)) {
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }

  if (await waitForProcessExit(pid, 1_000)) {
    return;
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Best-effort.
  }
}

async function ensureProcessTreeExit(pid, timeoutMs = 1_500) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  if (await waitForProcessExit(pid, timeoutMs)) {
    return;
  }

  await killProcessTree(pid);
  await waitForProcessExit(pid, 5_000);
}

async function safeClose(client, transport, connected) {
  const closeAttempts = [];

  if (connected) {
    closeAttempts.push(client.close().catch(() => undefined));
  }

  closeAttempts.push(transport.close?.().catch(() => undefined));
  await Promise.all(closeAttempts);
}

export async function withManagedStdioClientSession(options, callback) {
  const {
    serverCommand,
    serverArgs = [],
    serverEnv = {},
    cwd,
    clientInfo = { name: 'benchmark-runner', version: '1.0.0' },
    connectTimeoutMs = 10_000,
    onSpawn
  } = options;

  const { Client, StdioClientTransport } = await loadSdkClient();
  const transport = new StdioClientTransport({
    command: serverCommand,
    args: serverArgs,
    env: { ...process.env, ...serverEnv },
    cwd
  });
  const client = new Client(clientInfo);

  let connected = false;
  let settling = false;
  let spawnedPid = null;
  const connectPromise = client.connect(transport);
  const observeSpawn = (async () => {
    while (!settling) {
      if (transport.pid !== null) {
        spawnedPid = transport.pid;
        onSpawn?.(transport.pid);
        return;
      }
      await delay(10);
    }

    if (transport.pid !== null) {
      spawnedPid = transport.pid;
      onSpawn?.(transport.pid);
    }
  })();

  try {
    await withTimeout(connectPromise, connectTimeoutMs);
    connected = true;
    return await callback({ client, transport });
  } finally {
    settling = true;
    await observeSpawn.catch(() => undefined);
    const pidToKill = spawnedPid ?? transport.pid;
    await safeClose(client, transport, connected);
    await ensureProcessTreeExit(pidToKill);
    await Promise.race([connectPromise, delay(5_000)]).catch(() => undefined);
  }
}
