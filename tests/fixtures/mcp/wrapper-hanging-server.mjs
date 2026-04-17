import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pidFile = process.env.MCP_TEST_PID_FILE;

const sidecar = spawn(process.execPath, [path.join(__dirname, 'hanging-server.mjs')], {
  stdio: 'ignore'
});

function cleanupAndExit(code = 0) {
  if (sidecar.pid) {
    try {
      process.kill(sidecar.pid, 'SIGTERM');
    } catch {
      // Best-effort cleanup for test fixture shutdown.
    }
  }

  process.exit(code);
}

if (pidFile) {
  writeFileSync(
    pidFile,
    JSON.stringify({ wrapperPid: process.pid, sidecarPid: sidecar.pid }),
    'utf8'
  );
}

process.once('SIGTERM', () => cleanupAndExit(0));
process.once('SIGINT', () => cleanupAndExit(0));
process.once('SIGHUP', () => cleanupAndExit(0));

setInterval(() => {}, 1000);
