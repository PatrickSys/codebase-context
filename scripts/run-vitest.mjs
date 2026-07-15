// Spawns vitest via process.execPath to avoid bin-resolution failures when
// Node is invoked directly (e.g. `node scripts/run-vitest.mjs`) without pnpm.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const forwardedArgs = process.argv.slice(2);
const vitestArgs =
  forwardedArgs[0] === '--' ? forwardedArgs.slice(1) : forwardedArgs;

const vitestEntrypoint = fileURLToPath(
  new URL('../node_modules/vitest/vitest.mjs', import.meta.url)
);

const sensitiveEnvName = /TOKEN|KEY|SECRET|PASSWORD|AUTH|OPENAI|ANTHROPIC|CLAUDE/i;
const testEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !sensitiveEnvName.test(name))
);

const child = spawn(process.execPath, [vitestEntrypoint, 'run', ...vitestArgs], {
  stdio: 'inherit',
  env: testEnv
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on('error', (error) => {
  console.error('[test] Failed to start vitest:', error);
  process.exit(1);
});
