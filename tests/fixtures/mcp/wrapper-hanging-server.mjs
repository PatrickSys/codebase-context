import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pidFile = process.env.MCP_TEST_PID_FILE;

const sidecar = spawn(process.execPath, [path.join(__dirname, 'hanging-server.mjs')], {
  stdio: 'ignore'
});

if (pidFile) {
  writeFileSync(pidFile, JSON.stringify({ wrapperPid: process.pid, sidecarPid: sidecar.pid }), 'utf8');
}

setInterval(() => {}, 1000);
