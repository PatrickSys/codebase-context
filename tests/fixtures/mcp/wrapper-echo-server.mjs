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

if (pidFile) {
  writeFileSync(
    pidFile,
    JSON.stringify({ wrapperPid: process.pid, echoPid: echoChild.pid, sidecarPid: sidecar.pid }),
    'utf8'
  );
}

process.stdin.pipe(echoChild.stdin);
echoChild.stdout.pipe(process.stdout);

echoChild.on('exit', (code) => {
  process.exit(code ?? 0);
});

echoChild.on('error', (error) => {
  console.error(error);
  process.exit(1);
});
