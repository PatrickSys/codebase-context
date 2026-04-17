import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pidFile = process.env.MCP_TEST_PID_FILE;

const echoChild = spawn(process.execPath, [path.join(__dirname, 'echo-server.mjs')], {
  stdio: ['pipe', 'pipe', 'inherit']
});

const sidecar = spawn(process.execPath, [path.join(__dirname, 'hanging-server.mjs')], {
  stdio: 'ignore'
});

function cleanupChildren() {
  for (const child of [echoChild, sidecar]) {
    if (child.pid) {
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch {
        // Best-effort cleanup for test fixture shutdown.
      }
    }
  }
}

if (pidFile) {
  writeFileSync(
    pidFile,
    JSON.stringify({ wrapperPid: process.pid, echoPid: echoChild.pid, sidecarPid: sidecar.pid }),
    'utf8'
  );
}

process.stdin.pipe(echoChild.stdin);
echoChild.stdout.pipe(process.stdout);

process.once('SIGTERM', () => {
  cleanupChildren();
  process.exit(0);
});
process.once('SIGINT', () => {
  cleanupChildren();
  process.exit(0);
});
process.once('SIGHUP', () => {
  cleanupChildren();
  process.exit(0);
});

echoChild.on('exit', (code) => {
  cleanupChildren();
  process.exit(code ?? 0);
});

echoChild.on('error', (error) => {
  cleanupChildren();
  console.error(error);
  process.exit(1);
});
