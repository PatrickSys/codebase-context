import process from 'node:process';

async function loadSdkClient() {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
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
  const connectPromise = client.connect(transport);
  const spawnNotification = (async () => {
    if (typeof onSpawn !== 'function') {
      return;
    }

    while (!settling) {
      if (transport.pid !== null) {
        onSpawn(transport.pid);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    if (transport.pid !== null) {
      onSpawn(transport.pid);
    }
  })();

  try {
    await withTimeout(connectPromise, connectTimeoutMs);
    connected = true;
    return await callback({ client, transport });
  } finally {
    settling = true;
    await safeClose(client, transport, connected);
    await spawnNotification.catch(() => undefined);
    await Promise.race([connectPromise, delay(5_000)]).catch(() => undefined);
  }
}
